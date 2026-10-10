'use strict';
// Who gets an email, and when:
//  · someone added to a production team (and their role)
//  · a crew member booked on a production
//  · an official named on a match
//  · Producers and Admins: a new expense to approve; whoever added it: approved, rejected or paid back
//  · coaches of both teams, Producers and Admins: the officials confirmed a result
const Schema = require('../shared/schema');
const { log } = require('./util');

function makeNotify(app) {
  let chain = Promise.resolve();
  const later = (fn) => { chain = chain.then(fn).catch((e) => log('Notification failed:', e.message)); return chain; };
  const base = () => String(app.config.publicUrl || '').replace(/\/+$/, '');
  const link = (hash, label) => (base() ? { url: base() + '/' + hash, label } : null);
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d.data : null; };
  const teamName = async (team) => ((await data(team)) || {}).name || 'your production team';
  const members = async (team) => (await app.store.list(team, 'member')).filter((m) => !m.deleted);
  const producers = async (team) => (await members(team)).filter((m) => Schema.CAN.edit(m.data.role)).map((m) => m.data.email);
  const money = (n, org) => `${(org && org.currency) || 'ZAR'} ${(Number(n) || 0).toFixed(2)}`;
  const fixtureLine = async (f) => [f.name || f.autoName || 'Match', [f.startDate, f.startTime].filter(Boolean).join(' '), ((await data(f.venue)) || {}).name].filter(Boolean).join(' · ');
  const officialsOf = (f) => String((f && f.officials) || '').split(/\n+/).map((l) => { const i = l.indexOf(':'); return { role: i >= 0 ? l.slice(0, i).trim() : 'Official', name: (i >= 0 ? l.slice(i + 1) : l).trim().toLowerCase() }; }).filter((x) => x.name);

  return {
    idle: () => chain,

    memberAdded: (team, doc, by, isNew) => later(async () => {
      if (!isNew) return;
      const d = doc.data, tn = await teamName(team);
      const what = { Admin: 'run the team: members, settings and every record', Producer: 'manage productions, crew, bookings and costing', Scorer: 'score matches and control graphics', Crew: 'see productions and add your expenses with receipts', Coach: 'look after your club, teams, players and team sheets', Official: 'see the matches you officiate and confirm results' }[d.role] || '';
      await app.mail.send(d.email, { subject: `You have been added to ${tn}`, title: `Welcome to ${tn}`,
        lines: [`${by.data.name || by.data.email} added you as ${d.role}${what ? ': you can ' + what : ''}.`, 'Sign in with your Google account using this email address.'], button: link('', 'Open RFP Manager') });
    }),

    productionSaved: (team, cur, doc) => later(async () => {
      if (!doc || doc.deleted || doc.type !== 'production') return;
      const before = new Set(((cur && cur.data.crew) || []).map((r) => r.crewMember).filter(Boolean));
      const added = (doc.data.crew || []).filter((r) => r.crewMember && !before.has(r.crewMember));
      if (!added.length) return;
      const p = doc.data, venue = (await data(p.venue)) || {};
      for (const r of added) {
        const cm = await data(r.crewMember);
        if (!cm || !cm.email) continue;
        const role = ((await data(r.role)) || {}).name || '';
        await app.mail.send(cm.email, { subject: `Booked: ${p.name}${p.date ? ' on ' + p.date : ''}`, title: `You are booked on ${p.name}`,
          lines: [[role && `Role: ${role}`, p.date && `Date: ${p.date}${Number(p.days) > 1 ? ` (${p.days} days)` : ''}`, (r.callTime || p.txTime) && `Call / TX: ${r.callTime || p.txTime}`, venue.name && `Venue: ${[venue.name, venue.city].filter(Boolean).join(', ')}`].filter(Boolean).join(' · '), 'The call sheet and rundown are on RFP Manager.'],
          button: link('#/edit/production/' + doc.id, 'Open the production') });
      }
    }),

    fixtureSaved: (team, cur, doc) => later(async () => {
      if (!doc || doc.deleted || doc.type !== 'fixture') return;
      const was = new Set(officialsOf(cur && cur.data).map((o) => o.name));
      const fresh = officialsOf(doc.data).filter((o) => !was.has(o.name));
      if (!fresh.length) return;
      const officials = (await members(team)).filter((m) => m.data.role === 'Official');
      const line = await fixtureLine(doc.data);
      for (const o of fresh) {
        const m = officials.find((x) => String(x.data.officialName || x.data.name || '').trim().toLowerCase() === o.name);
        if (m) await app.mail.send(m.data.email, { subject: `${o.role}: ${line}`, title: `You are the ${o.role}`, lines: [line], button: link('#/edit/fixture/' + doc.id, 'Open the match') });
      }
    }),

    reportConfirmed: (team, doc) => later(async () => {
      const f = doc.data, r = f.officialReport;
      if (!r) return;
      const clubs = new Set();
      for (const s of [f.team1, f.team2]) { const sq = await data(s); if (sq && sq.club) clubs.add(sq.club); }
      const coaches = (await members(team)).filter((m) => m.data.role === 'Coach' && (m.data.clubs || []).some((c) => clubs.has(c))).map((m) => m.data.email);
      const to = [...coaches, ...(await producers(team))].filter((e) => e !== r.byEmail);
      const line = await fixtureLine(f);
      await app.mail.send(to, { subject: `Result: ${f.name || f.autoName || 'Match'} ${r.scoreA}–${r.scoreB}`, title: 'Result confirmed by the officials',
        lines: [line, `Score: ${r.scoreA} – ${r.scoreB}`, r.cards && `Cards and incidents: ${r.cards}`, r.notes && `Notes: ${r.notes}`, `Confirmed by ${r.by}.`].filter(Boolean), button: link('#/edit/fixture/' + doc.id, 'Open the match') });
    }),

    expenseSaved: (team, cur, doc, by) => later(async () => {
      const x = doc.data, org = await data(team), prod = (await data(x.production)) || {};
      const what = `${x.description} · ${money(x.amount, org)} · ${prod.name || 'production'}`;
      if (!cur) {
        const to = (await producers(team)).filter((e) => e !== x.submittedBy);
        await app.mail.send(to, { subject: `Expense to approve: ${x.description} (${money(x.amount, org)})`, title: 'A new expense to approve',
          lines: [what, `Added by ${x.paidBy || x.submittedBy}${x.receipt ? ', with a receipt' : ', without a receipt'}.`], button: link('#/edit/production/' + x.production, 'Approve it') });
      } else if (cur.data.status !== x.status && x.submittedBy && x.submittedBy !== by.data.email) {
        await app.mail.send(x.submittedBy, { subject: `Expense ${x.status.toLowerCase()}: ${x.description}`, title: `Your expense was ${x.status.toLowerCase()}`,
          lines: [what, `By ${x.decidedBy || by.data.name || by.data.email}.`, x.note && `Note: ${x.note}`].filter(Boolean), button: link('#/edit/production/' + x.production, 'Open the production') });
      }
    }),
  };
}

module.exports = { makeNotify };
