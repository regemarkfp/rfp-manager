'use strict';
// RFP Manager save file (XML). Export writes a production team in the layout of the original
// "Save File Template"; import reads that layout back (and is forgiving about unclosed tags).
const Schema = require('../shared/schema');
const Scoring = require('../shared/scoring');
const { detId } = require('./util');

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function parseXml(src) {
  src = String(src).replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const rx = /<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = rx.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.text += unesc(m[5]); continue; }
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[2]) { stack.length = i; break; }
      continue;
    }
    const node = { name: m[2], attrs: {}, children: [], text: '' };
    m[3].replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { node.attrs[k] = unesc(v); return ''; });
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

const deep = (node, name, out = []) => { for (const c of node.children) { if (c.name === name) out.push(c); deep(c, name, out); } return out; };
const txt = (node, ...names) => {
  for (const n of names) { const c = node.children.find((x) => x.name === n) || deep(node, n)[0]; if (c) { const t = c.text.trim().replace(/>$/, '').trim(); if (t) return t; } }
  return '';
};
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (s) => { const n = Number(String(s || '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) && String(s || '').match(/\d/) ? n : ''; };
const isoDate = (s) => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(s || '').trim()); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''; };
const zaDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const realId = (s) => (/^[\w-]{6,64}$/.test(s || '') ? s : '');
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', orange: '#ffa500', yellow: '#ffff00', purple: '#800080', pink: '#ffc0cb',
  grey: '#808080', gray: '#808080', navy: '#000080', maroon: '#800000', gold: '#ffd700', silver: '#c0c0c0', teal: '#008080', lime: '#00ff00', cyan: '#00ffff', brown: '#a52a2a' };
const hex = (s) => { const v = String(s || '').trim().toLowerCase(); if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return v; if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join(''); return NAMED[v] || ''; };

// -------------------------------------------------------------------------------------------
async function exportXml(app, team, user) {
  const docs = await app.store.listTeam(team);
  const by = (t) => docs.filter((d) => d.type === t);
  const get = (id) => { const d = docs.find((x) => x.id === id); return d ? d.data : null; };
  const org = get(team) || {};
  const base = String(app.config.publicUrl || '').replace(/\/+$/, '');
  const image = (id) => (id && get(id) ? `${base}/media/${id}` : '');
  const L = [];
  const tag = (n, v, pad) => L.push(`${pad}<${n}>${esc(v)}</${n}>`);
  const open = (n, pad) => L.push(`${pad}<${n}>`), close = (n, pad) => L.push(`${pad}</${n}>`);
  const stats = Scoring.playerStats(by('fixture').map((d) => d.data));
  const T = '\t';

  L.push('<?xml version="1.0" encoding="UTF-8"?>', '<production-Team>');
  open('account-details', T);
  open('user-production-team', T + T);
  tag('user-production-team-name', org.name, T.repeat(3)); tag('user-production-team-accent-color', org.accentColor || '#00ff82', T.repeat(3)); tag('user-production-team-image', image(org.image), T.repeat(3));
  close('user-production-team', T + T);
  open('user-account', T + T);
  tag('user', user.data.name, T.repeat(3)); tag('user-Id', user.id, T.repeat(3)); tag('image', user.data.image, T.repeat(3)); tag('email', user.data.email, T.repeat(3));
  tag('access', (by('member').find((m) => m.data.email === user.data.email) || { data: {} }).data.role || '', T.repeat(3));
  tag('sync-rate', (app.config.syncSeconds || 5) + ' Sec', T.repeat(3)); tag('currency', org.currency || 'ZAR', T.repeat(3));
  close('user-account', T + T);
  close('account-details', T);

  open('assets', T);
  open('themes', T + T);
  for (const d of by('theme')) { open('theme', T.repeat(3)); const p = T.repeat(4); tag('theme-id', d.id, p); tag('theme-name', d.data.name, p); tag('theme-description', d.data.description, p); tag('theme-sport', (d.data.sports || []).join(', '), p); tag('theme-template-folder', d.data.templateFolder, p); close('theme', T.repeat(3)); }
  close('themes', T + T);
  open('competitions', T + T);
  for (const d of by('competition')) {
    const c = d.data, p = T.repeat(4);
    open('competition', T.repeat(3));
    tag('competition-id', d.id, p); tag('competition-name', c.name, p); tag('competion-sport', c.sport, p); tag('competion-season', c.season, p); tag('competion-primary-color', c.primaryColor, p);
    tag('competion-secondary-color', c.secondaryColor, p); tag('competition-logo', image(c.logo), p); tag('competition-theme', (get(c.theme) || {}).name, p);
    close('competition', T.repeat(3));
  }
  close('competitions', T + T);
  open('players', T + T);
  const squads = by('squad');
  for (const d of by('player')) {
    const c = d.data, p = T.repeat(4), st = stats[d.id] || { stats: {}, teams: [] };
    const cur = squads.find((s) => (s.data.players || []).some((r) => r.player === d.id));
    const curName = cur ? Schema.resolveSquad(cur.data, get(cur.data.club)).name : '';
    open('player', T.repeat(3));
    tag('player-id', d.id, p); tag('player-name', c.name, p); tag('player-surname', c.surname, p); tag('player-sport', (c.sports || []).join(', '), p); tag('player-age', Schema.age(c.dateOfBirth), p);
    tag('player-height', c.height ? c.height + 'cm' : '', p); tag('player-weight', c.weight ? c.weight + 'kg' : '', p); tag('player-date_of_birth', zaDate(c.dateOfBirth), p);
    tag('player-nationality', c.nationality, p); tag('player-current-team', curName, p);
    open('player-previous-teams', p);
    for (const n of st.teams.filter((x) => x !== curName)) { open('player-previous-team', p + T); tag('player-previous-team-name', n, p + T + T); close('player-previous-team', p + T); }
    close('player-previous-teams', p);
    open('player-stats', p);
    for (const [k, v] of Object.entries(st.stats)) { open('player-stat', p + T); tag('player-stat-name', k, p + T + T); tag('player-stat-value', v, p + T + T); close('player-stat', p + T); }
    close('player-stats', p);
    close('player', T.repeat(3));
  }
  close('players', T + T);
  open('venues', T + T);
  for (const d of by('venue')) { const c = d.data, p = T.repeat(4); open('venue', T.repeat(3)); tag('venue-id', d.id, p); tag('venue-name', c.name, p); tag('venue-city', c.city, p); tag('venue-country', c.country, p); tag('venue-sport', (c.sports || []).join(', '), p); tag('venue-capacity', c.capacity, p); tag('venue-turf', c.turf, p); close('venue', T.repeat(3)); }
  close('venues', T + T);
  open('clubs', T + T);
  for (const d of by('club')) {
    const c = d.data, p = T.repeat(4);
    open('club', T.repeat(3));
    tag('club-id', d.id, p); tag('club-name', c.name, p); tag('club-graphic-name', c.graphicName, p); tag('club-abreviation', c.abbreviation, p); tag('club-primary-color', c.primaryColor, p); tag('club-secondary-color', c.secondaryColor, p); tag('club-image', image(c.image), p);
    open('teams', p);
    for (const s of squads.filter((x) => x.data.club === d.id)) {
      const t = s.data, q = T.repeat(6);
      open('team', p + T);
      tag('team-id', s.id, q); tag('team-sport', t.sport, q); tag('team-age-group', t.ageGroup, q); tag('team-name', t.name, q); tag('team-graphic-name', t.graphicName, q); tag('team-abreviation', t.abbreviation, q);
      tag('team-primary-color', t.primaryColor, q); tag('team-secondary-color', t.secondaryColor, q); tag('team-image', image(t.image), q);
      open('team-players', q);
      for (const r of t.players || []) { const pl = get(r.player); if (pl) L.push(`${q}${T}<team-player number="${esc(r.number).replace(/"/g, '&quot;')}" position="${esc(r.position).replace(/"/g, '&quot;')}" player-id="${esc(r.player)}">${esc([pl.name, pl.surname].filter(Boolean).join(' '))}</team-player>`); }
      close('team-players', q);
      close('team', p + T);
    }
    close('teams', p);
    close('club', T.repeat(3));
  }
  close('clubs', T + T);
  close('assets', T);

  const squadName = (id) => { const s = get(id); return s ? [Schema.resolveSquad(s, get(s.club)).name, s.ageGroup].filter(Boolean).join(' ') : ''; };
  const match = (d, withResult) => {
    const f = d.data, p = T.repeat(3);
    open('match', T + T);
    tag('match-id', d.id, p); tag('match-name', f.name || f.autoName, p); tag('match-sport', f.sport, p); tag('match-tournament', (get(f.competition) || {}).name, p);
    tag('match-start-date', zaDate(f.startDate), p); tag('match-start-time', f.startTime, p); tag('match-end-date', zaDate(f.endDate), p); tag('match-end-time', f.endTime, p);
    tag('match-team1', squadName(f.team1), p); tag('match-team2', squadName(f.team2), p); tag('match-period-length', f.periodLength, p); tag('match-total-periods', f.totalPeriods, p);
    tag('match-venue', (get(f.venue) || {}).name, p); tag('match-status', f.status, p);
    if (withResult && (f.result || f.live)) { const r = f.result || Scoring.summary(f.live); const parts = String(r.text).split(/ [|–] /); tag('match-score1', parts[0] || r.a, p); tag('match-score2', parts[1] || r.b, p); tag('match-result', r.status, p); }
    if ((f.rundown || []).length) {
      open('match-rundown', p);
      Schema.rundownTimes(f.rundown, f.startTime).forEach((r, i) => {
        const q = T.repeat(5);
        open('rundown-item', p + T);
        tag('match-rundown-id', i + 1, q); tag('match-rundown-content', r.content, q); tag('match-rundown-content-description', r.description, q); tag('match-rundown-start-time', r.startText, q);
        tag('match-rundown-source', r.source, q); tag('match-rundown-audio', r.audio, q); tag('match-rundown-graphics', r.graphics, q); tag('match-rundown-duration', Schema.fmtDuration(Schema.parseDuration(r.duration)), q);
        close('rundown-item', p + T);
      });
      close('match-rundown', p);
    }
    close('match', T + T);
  };
  open('fixtures', T); for (const d of by('fixture').filter((x) => x.data.status !== 'Completed')) match(d, false); close('fixtures', T);
  open('results', T); for (const d of by('fixture').filter((x) => x.data.status === 'Completed')) match(d, true); close('results', T);

  const person = (id) => { const m = get(id); return m ? { name: [m.name, m.surname].filter(Boolean).join(' '), phone: m.phone || '' } : { name: '', phone: '' }; };
  open('productions', T);
  for (const d of by('production')) {
    const c = d.data, p = T.repeat(3), cost = Schema.costing(c, get);
    const member = (r, pad) => { open('production-crew-member', pad); tag('production-crew-member-name', person(r.crewMember).name, pad + T); tag('production-crew-member-number', person(r.crewMember).phone, pad + T); tag('production-crew-member-call-time', r.callTime, pad + T); tag('production-crew-member-production-time', r.productionTime, pad + T); close('production-crew-member', pad); };
    open('production', T + T);
    tag('production-id', d.id, p); tag('production-name', c.name, p); tag('production-type', c.type, p); tag('production-date', zaDate(c.date), p); tag('production-venue', (get(c.venue) || {}).name, p); tag('production-client', c.client, p); tag('production-description', c.description, p);
    open('production-coordinators', p);
    for (const r of c.contacts || []) {
      const who = person(r.crewMember);
      open('production-coordinator', p + T); tag('production-coordinator-title', r.title, p + T + T); tag('production-crew-member-name', r.name || who.name, p + T + T); tag('production-crew-member-number', r.phone || who.phone, p + T + T); close('production-coordinator', p + T);
    }
    close('production-coordinators', p);
    open('production-equipment', p);
    for (const cat of Schema.EQUIP_CATS) {
      const rows = (c.equipment || []).filter((r) => ((get(r.item) || {}).category || 'Other') === cat);
      if (!rows.length) continue;
      const n = `production-${cat.toLowerCase()}-equipment`;
      open(n, p + T); for (const r of rows) L.push(`${p}${T}${T}<item quantity="${esc(r.quantity || 1)}">${esc((get(r.item) || {}).name)}</item>`); close(n, p + T);
    }
    close('production-equipment', p);
    open('production-crew', p); tag('production-crew-notes', c.crewNotes, p + T);
    for (const r of c.crew || []) { tag('production-crew-member-role', (get(r.role) || {}).name, p + T); member(r, p + T); }
    close('production-crew', p);
    open('production-costing', p); tag('production-cost', cost.cost, p + T); tag('production-invoice', cost.invoice, p + T); tag('production-profit', cost.profit, p + T); tag('production-currency', org.currency || 'ZAR', p + T); close('production-costing', p);
    close('production', T + T);
  }
  close('productions', T);

  open('crew', T);
  open('crew-members', T + T);
  for (const d of by('crewMember')) {
    const c = d.data, p = T.repeat(4);
    open('crew-member', T.repeat(3));
    tag('crew-member-id', d.id, p); tag('crew-member-name', c.name, p); tag('crew-member-surname', c.surname, p); tag('crew-member-age', Schema.age(c.dateOfBirth), p); tag('crew-member-date_of_birth', zaDate(c.dateOfBirth), p);
    tag('crew-member-id-number', c.idNumber, p); tag('crew-member-phone-number', c.phone, p); tag('crew-member-email', c.email, p); tag('crew-member-image', image(c.image), p);
    close('crew-member', T.repeat(3));
  }
  close('crew-members', T + T);
  open('crew-roles', T + T);
  for (const d of by('crewRole')) { const c = d.data, p = T.repeat(4); open('role', T.repeat(3)); tag('role-name', c.name, p); tag('role-maximum-quantity', c.maxQuantity, p); tag('role-rate', c.rate, p); tag('role-invoice-rate', c.invoiceRate, p); tag('role-currency', org.currency || 'ZAR', p); close('role', T.repeat(3)); }
  close('crew-roles', T + T);
  close('crew', T);
  open('equipment', T);
  for (const d of by('equipment')) { const c = d.data, p = T.repeat(3); open('equipment-item', T + T); tag('equipment-id', d.id, p); tag('equipment-name', c.name, p); tag('equipment-category', c.category, p); tag('equipment-quantity', c.quantity, p); tag('equipment-rate', c.rate, p); tag('equipment-invoice-rate', c.invoiceRate, p); close('equipment-item', T + T); }
  close('equipment', T);
  L.push('</production-Team>', '');
  return L.join('\n');
}

// -------------------------------------------------------------------------------------------
async function importXml(app, team, xml, userId, fetchImage) {
  const root = parseXml(xml);
  if (!deep(root, 'production-Team').length && !deep(root, 'assets').length) throw new Error('This does not look like an RFP Manager save file');
  const counts = {};
  const existing = await app.store.listTeam(team);
  const save = async (type, id, data) => {
    const cur = existing.find((d) => d.id === id);
    await app.write(team, type, id, { ...(cur ? cur.data : {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== undefined)) }, userId);
    counts[type] = (counts[type] || 0) + 1;
    return id;
  };
  const idFor = (type, given, ...key) => realId(given) || detId(type.slice(0, 4) + '_', team, type, ...key.map((k) => String(k).toLowerCase()));
  const img = async (url, name) => {
    const m = /\/media\/([\w-]+)$/.exec(url || '');
    if (m && existing.some((d) => d.id === m[1] && d.type === 'image')) return m[1];
    if (!/^https?:\/\//i.test(url || '') || !fetchImage) return '';
    try { return await fetchImage(team, url, name, userId); } catch { return ''; }
  };

  const orgNode = deep(root, 'user-production-team')[0];
  if (orgNode) {
    const cur = existing.find((d) => d.id === team);
    const patch = { accentColor: hex(txt(orgNode, 'user-production-team-accent-color')), currency: txt(root, 'currency'), image: await img(txt(orgNode, 'user-production-team-image'), 'Dashboard') };
    await app.write(team, 'org', team, { ...(cur ? cur.data : {}), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v)) }, userId);
  }

  const themes = {};
  for (const n of deep(root, 'theme')) {
    const name = txt(n, 'theme-name'); if (!name) continue;
    themes[name.toLowerCase()] = await save('theme', idFor('theme', txt(n, 'theme-id'), name), { name, description: txt(n, 'theme-description'), sports: csv(txt(n, 'theme-sport')), templateFolder: txt(n, 'theme-template-folder') });
  }
  const comps = {};
  for (const n of deep(root, 'competition')) {
    const name = txt(n, 'competition-name'); if (!name) continue;
    const season = txt(n, 'competion-season', 'competition-season');
    comps[name.toLowerCase()] = await save('competition', idFor('competition', txt(n, 'competition-id'), name, season), { name, sport: txt(n, 'competion-sport', 'competition-sport'), season,
      primaryColor: hex(txt(n, 'competion-primary-color', 'competition-primary-color')), secondaryColor: hex(txt(n, 'competion-secondary-color', 'competition-secondary-color')),
      logo: await img(txt(n, 'competition-logo'), name), theme: themes[txt(n, 'competition-theme').toLowerCase()] || '' });
  }
  const players = {};
  for (const n of deep(root, 'player')) {
    const name = txt(n, 'player-name'), surname = txt(n, 'player-surname'); if (!name) continue;
    const dob = isoDate(txt(n, 'player-date_of_birth', 'player-date-of-birth'));
    players[`${name} ${surname}`.trim().toLowerCase()] = await save('player', idFor('player', txt(n, 'player-id'), name, surname, dob), { name, surname, sports: csv(txt(n, 'player-sport')), dateOfBirth: dob,
      height: num(txt(n, 'player-height')), weight: num(txt(n, 'player-weight')), nationality: txt(n, 'player-nationality') });
  }
  const venues = {};
  for (const n of deep(root, 'venue')) {
    const name = txt(n, 'venue-name'); if (!name) continue;
    venues[name.toLowerCase()] = await save('venue', idFor('venue', txt(n, 'venue-id'), name), { name, city: txt(n, 'venue-city'), country: txt(n, 'venue-country'), sports: csv(txt(n, 'venue-sport')), capacity: num(txt(n, 'venue-capacity')), turf: txt(n, 'venue-turf') });
  }
  const squads = {};
  for (const n of deep(root, 'club')) {
    const name = txt(n, 'club-name'); if (!name) continue;
    const clubId = await save('club', idFor('club', txt(n, 'club-id'), name), { name, graphicName: txt(n, 'club-graphic-name'), abbreviation: txt(n, 'club-abreviation', 'club-abbreviation'),
      primaryColor: hex(txt(n, 'club-primary-color')), secondaryColor: hex(txt(n, 'club-secondary-color')), image: await img(txt(n, 'club-image'), name) });
    const club = { name, graphicName: txt(n, 'club-graphic-name'), abbreviation: txt(n, 'club-abreviation', 'club-abbreviation'), primaryColor: hex(txt(n, 'club-primary-color')), secondaryColor: hex(txt(n, 'club-secondary-color')) };
    for (const t of deep(n, 'team')) {
      const sport = txt(t, 'team-sport'), ageGroup = txt(t, 'team-age-group');
      if (!sport && !ageGroup) continue;
      // A value that only repeats the club's is left empty so the team keeps inheriting it.
      const own = (v, k) => (v && v !== club[k] ? v : '');
      const rows = t.children.filter((c) => c.name === 'team-players').flatMap((c) => c.children).filter((c) => c.name.startsWith('team-player') && (c.attrs['player-id'] || c.text.trim()))
        .map((c) => ({ number: c.attrs.number || c.name.replace(/^team-player#?/, ''), player: realId(c.attrs['player-id']) || players[c.text.trim().toLowerCase()] || '', position: c.attrs.position || '' })).filter((r) => r.player);
      const tname = txt(t, 'team-name');
      const id = await save('squad', idFor('squad', txt(t, 'team-id'), name, sport, ageGroup), { club: clubId, sport, ageGroup, name: own(tname, 'name'), graphicName: own(txt(t, 'team-graphic-name'), 'graphicName'),
        abbreviation: own(txt(t, 'team-abreviation', 'team-abbreviation'), 'abbreviation'), primaryColor: own(hex(txt(t, 'team-primary-color')), 'primaryColor'), secondaryColor: own(hex(txt(t, 'team-secondary-color')), 'secondaryColor'),
        image: await img(txt(t, 'team-image'), tname || name), ...(rows.length ? { players: rows } : {}) });
      for (const key of [tname || name, `${tname || name} ${ageGroup}`.trim()]) squads[`${sport}|${key}`.toLowerCase()] = squads[`${sport}|${key}`.toLowerCase()] || id;
    }
  }
  for (const n of deep(root, 'match')) {
    const sport = txt(n, 'match-sport'), t1 = txt(n, 'match-team1'), t2 = txt(n, 'match-team2'), date = isoDate(txt(n, 'match-start-date')), name = txt(n, 'match-name');
    const rundown = deep(n, 'rundown-item').map((r) => ({ content: txt(r, 'match-rundown-content'), description: txt(r, 'match-rundown-content-description'), startTime: txt(r, 'match-rundown-start-time'),
      source: txt(r, 'match-rundown-source'), audio: txt(r, 'match-rundown-audio'), graphics: txt(r, 'match-rundown-graphics'), duration: txt(r, 'match-rundown-duration') })).filter((r) => r.content);
    if (!realId(txt(n, 'match-id')) && !name && !t1 && !date && !rundown.length) continue;       // an empty template row
    const st = txt(n, 'match-status');
    await save('fixture', idFor('fixture', txt(n, 'match-id'), name, sport, t1, t2, date), { name, sport, competition: comps[txt(n, 'match-tournament').toLowerCase()] || '', startDate: date, startTime: txt(n, 'match-start-time'),
      endDate: isoDate(txt(n, 'match-end-date')), endTime: txt(n, 'match-end-time'), team1: squads[`${sport}|${t1}`.toLowerCase()] || '', team2: squads[`${sport}|${t2}`.toLowerCase()] || '',
      periodLength: num(txt(n, 'match-period-length')), totalPeriods: num(txt(n, 'match-total-periods')), venue: venues[txt(n, 'match-venue').toLowerCase()] || '',
      status: Schema.STATUSES.find((s) => s.toLowerCase() === st.toLowerCase()) || 'Upcoming', ...(rundown.length ? { rundown } : {}) });
  }
  const roles = {};
  for (const n of deep(root, 'role')) {
    const name = txt(n, 'role-name'); if (!name) continue;
    roles[name.toLowerCase()] = await save('crewRole', idFor('crewRole', '', name), { name, maxQuantity: num(txt(n, 'role-maximum-quantity')), rate: num(txt(n, 'role-rate')), invoiceRate: num(txt(n, 'role-invoice-rate')) });
  }
  for (const n of deep(root, 'crew-member')) {
    const name = txt(n, 'crew-member-name'); if (!name) continue;
    const surname = txt(n, 'crew-member-surname');
    await save('crewMember', idFor('crewMember', txt(n, 'crew-member-id'), name, surname), { name, surname, dateOfBirth: isoDate(txt(n, 'crew-member-date_of_birth')), idNumber: txt(n, 'crew-member-id-number'),
      phone: txt(n, 'crew-member-phone-number'), email: txt(n, 'crew-member-email'), image: await img(txt(n, 'crew-member-image'), name) });
  }
  for (const n of deep(root, 'production')) {
    const name = txt(n, 'production-name'); if (!name) continue;
    await save('production', idFor('production', txt(n, 'production-id'), name), { name, type: txt(n, 'production-type'), date: isoDate(txt(n, 'production-date')), client: txt(n, 'production-client'),
      venue: venues[txt(n, 'production-venue').toLowerCase()] || '', description: txt(n, 'production-description'), crewNotes: txt(n, 'production-crew-notes') });
  }
  return counts;
}

module.exports = { parseXml, exportXml, importXml, hex };
