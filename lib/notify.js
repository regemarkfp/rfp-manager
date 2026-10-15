'use strict';
// Who gets an email, and when:
//  · someone added to a production team (and their role)
//  · a new production: the production team (unless they switched these off)
//  · a crew member ticked as confirmed on a production: "hired", with their call sheet
//  · an official named on a match
//  · Producers and Admins: a new expense to approve; whoever added it: approved, rejected or paid back
//  · coaches of both teams, Producers and Admins: the officials confirmed a result
const Schema = require('../shared/schema');
const { log } = require('./util');

function makeNotify(app) {
  let chain = Promise.resolve();
  const later = (fn) => { chain = chain.then(fn).catch((e) => log('Notification failed:', e.message)); return chain; };
  const base = () => String(app.config.publicUrl || '').replace(/\/+$/, '');
  const link = (hash, label) => (base() ? { url: base() + (hash.startsWith('#') ? '/app/' : '/') + hash, label } : null);
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d.data : null; };
  const teamName = async (team) => ((await data(team)) || {}).name || 'your production team';
  const members = async (team) => (await app.store.list(team, 'member')).filter((m) => !m.deleted);
  const producers = async (team) => (await members(team)).filter((m) => Schema.CAN.edit(m.data.role)).map((m) => m.data.email);
  const money = (n, org) => `${(org && org.currency) || 'ZAR'} ${(Number(n) || 0).toFixed(2)}`;
  const fixtureLine = async (f) => [f.name || f.autoName || 'Match', [f.startDate, f.startTime].filter(Boolean).join(' '), ((await data(f.venue)) || {}).name].filter(Boolean).join(' · ');
  const fmtDate = (d) => { const t = new Date(String(d) + 'T12:00:00Z'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const officialsOf = (f) => String((f && f.officials) || '').split(/\n+/).map((l) => { const i = l.indexOf(':'); return { role: i >= 0 ? l.slice(0, i).trim() : 'Official', name: (i >= 0 ? l.slice(i + 1) : l).trim().toLowerCase() }; }).filter((x) => x.name);

  // subscribers of a channel: the stream on it just went live (once per half hour per stream)
  const told = new Map();
  app.on('stream', (slug, view, wasLive) => {
    if (!view || !view.live || wasLive || !app.mail.enabled()) return;
    if (told.get(slug) > Date.now() - 30 * 60e3) return;
    told.set(slug, Date.now());
    later(async () => {
      const s = await app.streaming.streamOf(slug);
      if (!s || (s.ch.data.access || 'Public') !== 'Public') return;
      const to = (await app.store.listType('user')).filter((u) => !u.deleted && Array.isArray(u.data.subscriptions) && u.data.subscriptions.includes(s.ch.id)).map((u) => u.data.email);
      const title = s.prod.data.streamTitle || s.prod.data.name;
      await app.mail.send(to, { subject: `${s.ch.data.name} is live: ${title}`, title: `${s.ch.data.name} is live`, lines: [title],
        button: link('watch/' + slug, 'Watch now'), footer: `You get this because you subscribed to ${s.ch.data.name}. Unsubscribe on the channel page.` });
    });
  });

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
      const p = doc.data, venue = (await data(p.venue)) || {}, org = (await data(team)) || {};
      const when = [p.date && fmtDate(p.date), Number(p.days) > 1 && `${p.days} days`, p.txTime && `TX ${p.txTime}`].filter(Boolean).join(' · ');
      const where = [venue.name, venue.city].filter(Boolean).join(', ');

      // a new production (event): the production team hears about it
      if (!cur || cur.deleted) {
        const by = doc.updatedBy ? await app.store.get(doc.updatedBy) : null;
        const byEmail = by && by.data ? String(by.data.email || '').toLowerCase() : '';
        const to = (await members(team)).filter((m) => ['Admin', 'Producer', 'Scorer', 'Crew'].includes(m.data.role || 'Crew')).map((m) => m.data.email).filter((e) => String(e).toLowerCase() !== byEmail);
        await app.mail.send(to, { kind: 'newEvent', subject: `New production: ${p.name}${p.date ? ' on ' + fmtDate(p.date) : ''}`, title: 'A new production is on the calendar',
          lines: [p.name, when, where, by && by.data ? `Added by ${by.data.name || by.data.email}.` : ''].filter(Boolean), button: link('#/calendar', 'Open the calendar'),
          footer: `You get this because you are in ${org.name || 'a production team'}. Switch these off under Settings → My account.` });
      }

      // hired: a crew member on the call sheet, ticked as confirmed (once per person per production)
      const wasHired = new Set(((cur && !cur.deleted && cur.data.crew) || []).filter((r) => r.confirmed && r.crewMember).map((r) => r.crewMember));
      const hired = [...new Map((p.crew || []).filter((r) => r.confirmed && r.crewMember && !wasHired.has(r.crewMember)).map((r) => [r.crewMember, r])).values()];
      if (!hired.length) return;
      const names = new Map(), roles = new Map();
      for (const r of p.crew || []) {
        if (r.crewMember && !names.has(r.crewMember)) names.set(r.crewMember, (await data(r.crewMember)) || {});
        if (r.role && !roles.has(r.role)) roles.set(r.role, ((await data(r.role)) || {}).name || '');
      }
      const crewRows = (me) => (p.crew || []).filter((r) => r.crewMember || r.role).map((r) => {
        const cm = names.get(r.crewMember) || {};
        const row = [roles.get(r.role) || 'Crew', cm.name || '(to be confirmed)', [r.location, r.callTime && 'call ' + r.callTime].filter(Boolean).join(' · '), cm.phone || ''];
        if (r.crewMember === me) row.mine = true;
        return row;
      });
      const contactRows = async (pp) => { const out = []; for (const c of pp.contacts || []) { const cm = c.crewMember ? (await data(c.crewMember)) || {} : {}; const n = cm.name || c.name; if (n) out.push([c.title || 'Contact', n, c.phone || cm.phone || '']); } return out; };
      const notes = String(p.crewNotes || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 && i < 40 ? [l.slice(0, i), l.slice(i + 1).trim()] : ['', l]; });
      for (const r of hired) {
        const cm = names.get(r.crewMember) || {};
        if (!cm.email) continue;
        const role = roles.get(r.role) || '';
        await app.mail.send(cm.email, {
          subject: `Hired: ${p.name}${p.date ? ' on ' + fmtDate(p.date) : ''}`, title: `You are hired for ${p.name}`,
          lines: [`${cm.name ? 'Hi ' + cm.name.split(' ')[0] + ', you' : 'You'} are confirmed${role ? ' as ' + role : ''} for ${p.name}. Your call sheet is below.`],
          sections: [
            { heading: `${String(org.name || 'Production').toUpperCase()} call sheet`, rows: [
              ['Production', p.name], p.event && ['Event', p.event], p.date && ['Date', fmtDate(p.date) + (Number(p.days) > 1 ? ` (${p.days} days)` : '')],
              role && ['Your role', role + (r.location ? ' · ' + r.location : '')], r.callTime && ['Your call time', r.callTime],
              (r.productionTime || p.txTime) && ['TX time', r.productionTime || p.txTime],
              where && ['Venue', where], p.remoteStudio && ['Remote studio / gallery', [p.remoteStudio, p.remoteStudioAddress].filter(Boolean).join(', ')]].filter(Boolean) },
            { heading: 'Key contacts', rows: await contactRows(p) },
            { heading: 'Crew you will work with', rows: crewRows(r.crewMember) },
            { heading: 'Additional information', rows: notes },
            { heading: 'Emergency: nearest hospitals', rows: (p.hospitals || []).filter((x) => x.name).map((x) => [x.name, [x.area, x.phone].filter(Boolean).join(' · ')]) }],
          button: link('#/callsheet/' + doc.id, 'Open the call sheet') });
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

    bookingSaved: (team, cur, doc, by) => later(async () => {
      const b = doc.data, was = (cur && cur.data) || {};
      const what = [b.service || 'Booking', b.organisation || b.name, b.date && fmtDate(b.date)].filter(Boolean).join(' · ');
      if (b.producer && b.producer !== was.producer && b.producer !== by.data.email) {
        await app.mail.send(b.producer, { subject: `Booking for you: ${what}`, title: 'A booking request is allocated to you',
          lines: [what, b.details || '', 'Open it to accept or decline.'].filter(Boolean), button: link('#/edit/booking/' + doc.id, 'Open the booking') });
      }
      if (b.status !== was.status && ['Accepted', 'Declined by producer'].includes(b.status)) {
        const admins = (await members(team)).filter((m) => m.data.role === 'Admin').map((m) => m.data.email).filter((e) => e !== by.data.email);
        await app.mail.send(admins, { subject: `${b.status === 'Accepted' ? 'Accepted' : 'Declined'}: ${what}`, title: b.status === 'Accepted' ? 'A Producer accepted a booking' : 'A Producer declined a booking',
          lines: [what, `${by.data.name || by.data.email}${b.response ? ': ' + b.response : ''}`, b.status === 'Accepted' ? 'A production was made for it.' : 'Allocate it to another Producer.'], button: link('#/edit/booking/' + doc.id, 'Open the booking') });
      }
    }),

    bookingReceived: (team, doc) => later(async () => {
      const b = doc.data, site = app.config.publicName || app.config.name || 'RFP Manager';
      const rows = [['Name', b.name], b.organisation && ['Organisation', b.organisation], b.email && ['Email', b.email], b.phone && ['Phone', b.phone], b.service && ['Service', b.service],
        b.date && ['Date', fmtDate(b.date)], b.venue && ['Where', b.venue]].filter(Boolean);
      await app.mail.send((await members(team)).filter((m) => m.data.role === 'Admin').map((m) => m.data.email), { subject: `Booking request: ${b.service || 'services'} – ${b.name}`, title: 'A new booking request from the website',
        lines: [b.details || ''].filter(Boolean), sections: [{ heading: 'Request', rows }], button: link('#/edit/booking/' + doc.id, 'Open the request'),
        footer: `Sent to the Admins of ${await teamName(team)}, who allocate it to a Producer.` });
      if (b.email) await app.mail.send(b.email, { subject: `Thank you – ${site}`, title: 'We have your request',
        lines: [`Hi ${String(b.name).split(' ')[0]}, thank you for your booking request${b.service ? ' for ' + b.service : ''}. We will be in touch soon.`], sections: [{ heading: 'What you sent', rows: rows.concat(b.details ? [['Details', b.details]] : []) }],
        footer: `You get this because you sent a booking request on ${site}.` });
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
