/* RFP Manager – athletics catalogue: genders, age groups, disciplines and rounds, for dropdowns in the scorer and for
 * reading event names that come from timing systems ("Men's 100 Meter", "Girls U16 80m Hurdles", "WOMEN LONG JUMP").
 * The same file runs in the browser (window.Athletics) and in Node (lib/timing.js, tests). */
(function () {
  'use strict';

  const GENDERS = ['Men', 'Women', 'Boys', 'Girls', 'Mixed'];
  const AGES = ['Open', 'Senior', 'U23', 'U20', 'U19', 'U18', 'U17', 'U16', 'U15', 'U14', 'U13', 'U12', 'U11', 'U10', 'U9', 'U8',
    'Masters', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60', 'M65', 'M70', 'M75', 'M80', 'Para'];

  // kind: track (lower time wins) | field (higher mark wins); wind: wind is measured
  const D = (name, group, kind, extra) => Object.assign({ name, group, kind }, extra || {});
  const DISCIPLINES = [
    ...['60m', '70m', '80m'].map(n => D(n, 'Sprints', 'track', { wind: n !== '60m', metres: parseInt(n, 10) })),
    D('100m', 'Sprints', 'track', { wind: true, metres: 100 }), D('150m', 'Sprints', 'track', { wind: true, metres: 150 }), D('200m', 'Sprints', 'track', { wind: true, metres: 200 }),
    D('300m', 'Sprints', 'track', { metres: 300 }), D('400m', 'Sprints', 'track', { metres: 400 }),
    ...['600m', '800m', '1000m', '1200m', '1500m', '1600m', 'Mile', '2000m', '3000m', '3200m'].map(n => D(n, 'Middle distance', 'track', { metres: n === 'Mile' ? 1609 : parseInt(n, 10) })),
    ...['5000m', '10000m'].map(n => D(n, 'Long distance', 'track', { metres: parseInt(n, 10) })),
    D('60m Hurdles', 'Hurdles', 'track', { metres: 60, hurdles: true }), D('75m Hurdles', 'Hurdles', 'track', { wind: true, metres: 75, hurdles: true }),
    D('80m Hurdles', 'Hurdles', 'track', { wind: true, metres: 80, hurdles: true }), D('90m Hurdles', 'Hurdles', 'track', { wind: true, metres: 90, hurdles: true }),
    D('100m Hurdles', 'Hurdles', 'track', { wind: true, metres: 100, hurdles: true }), D('110m Hurdles', 'Hurdles', 'track', { wind: true, metres: 110, hurdles: true }),
    D('200m Hurdles', 'Hurdles', 'track', { metres: 200, hurdles: true }), D('300m Hurdles', 'Hurdles', 'track', { metres: 300, hurdles: true }), D('400m Hurdles', 'Hurdles', 'track', { metres: 400, hurdles: true }),
    D('1500m Steeplechase', 'Steeplechase', 'track', { metres: 1500, steeple: true }), D('2000m Steeplechase', 'Steeplechase', 'track', { metres: 2000, steeple: true }), D('3000m Steeplechase', 'Steeplechase', 'track', { metres: 3000, steeple: true }),
    D('4x100m Relay', 'Relays', 'track', { metres: 400, relay: true }), D('4x200m Relay', 'Relays', 'track', { metres: 800, relay: true }), D('4x400m Relay', 'Relays', 'track', { metres: 1600, relay: true }),
    D('4x800m Relay', 'Relays', 'track', { metres: 3200, relay: true }), D('Medley Relay', 'Relays', 'track', { relay: true, words: ['medley', 'swedish'] }), D('Shuttle Hurdles Relay', 'Relays', 'track', { relay: true, words: ['shuttle'] }),
    ...['3000m', '5000m', '10000m'].map(n => D(n + ' Race Walk', 'Race walk', 'track', { metres: parseInt(n, 10), walk: true })),
    D('10km Race Walk', 'Race walk', 'track', { metres: 10000, walk: true, road: true }), D('20km Race Walk', 'Race walk', 'track', { metres: 20000, walk: true, road: true }), D('35km Race Walk', 'Race walk', 'track', { metres: 35000, walk: true, road: true }),
    D('5km', 'Road', 'track', { metres: 5000, road: true }), D('10km', 'Road', 'track', { metres: 10000, road: true }), D('15km', 'Road', 'track', { metres: 15000, road: true }),
    D('Half Marathon', 'Road', 'track', { metres: 21097, road: true, words: ['half marathon'] }), D('Marathon', 'Road', 'track', { metres: 42195, road: true, words: ['marathon'] }),
    D('Cross Country', 'Cross country', 'track', { words: ['cross country', 'xc'] }),
    D('High Jump', 'Jumps', 'field', { words: ['high jump', 'hj'] }), D('Pole Vault', 'Jumps', 'field', { words: ['pole vault', 'pv'] }),
    D('Long Jump', 'Jumps', 'field', { wind: true, words: ['long jump', 'lj'] }), D('Triple Jump', 'Jumps', 'field', { wind: true, words: ['triple jump', 'tj'] }),
    D('Shot Put', 'Throws', 'field', { words: ['shot put', 'shot', 'sp'] }), D('Discus Throw', 'Throws', 'field', { words: ['discus', 'dt'] }),
    D('Hammer Throw', 'Throws', 'field', { words: ['hammer', 'ht'] }), D('Javelin Throw', 'Throws', 'field', { words: ['javelin', 'jt'] }),
    D('Pentathlon', 'Combined events', 'field', { points: true, words: ['pentathlon'] }), D('Heptathlon', 'Combined events', 'field', { points: true, words: ['heptathlon'] }), D('Decathlon', 'Combined events', 'field', { points: true, words: ['decathlon'] }),
  ];
  const ROUNDS = ['Heat', 'Quarter-final', 'Semi-final', 'Final', 'A Final', 'B Final', 'Timed final', 'Qualification', 'Round', 'Repechage', 'Race'];
  const NUMBERED = ['Heat', 'Quarter-final', 'Semi-final', 'Qualification', 'Round', 'Race'];
  const ROLES = ['Referee', 'Track referee', 'Field referee', 'Starter', 'Recaller', 'Chief judge', 'Photo finish judge', 'Wind gauge operator', 'Technical delegate', 'Competition director', 'Announcer', 'Timekeeper', 'Clerk of course', 'Meeting manager'];
  const NOTES = ['', 'PB', 'SB', 'NR', 'AR', 'CR', 'MR', 'WR', 'Q', 'q', 'DNF', 'DNS', 'DQ', 'NM', 'NH'];

  const byName = name => DISCIPLINES.find(d => d.name === name) || null;
  /** "Heat 2", "Final", "Qualification group A" */
  function roundLabel(round, n) {
    if (!round) return '';
    if (round === 'Qualification' && n) return `Qualification group ${/^\d+$/.test(String(n)) ? String.fromCharCode(64 + Number(n)) : n}`;
    return NUMBERED.includes(round) && n ? `${round} ${n}` : round;
  }
  /** The event's display name: "100m Men", "80m Hurdles Girls U16", "4x400m Relay Mixed" */
  function eventName(e) {
    if (!e || !e.discipline) return (e && e.name) || '';
    const age = e.age && e.age !== 'Open' && e.age !== 'Senior' ? ' ' + e.age : '';
    return `${e.discipline}${e.gender ? ' ' + e.gender : ''}${age}`;
  }

  // ---- reading names from timing systems and meet software
  const GENDER_WORDS = [[/\b(mixed|coed|co-ed)\b/i, 'Mixed'], [/\b(boys?)\b/i, 'Boys'], [/\b(girls?)\b/i, 'Girls'], [/\b(women'?s?|woman|ladies|female|wom)\b/i, 'Women'], [/\b(men'?s?|man|male|gents)\b/i, 'Men']];
  function parseAge(s) {
    let m = /\b(?:u|under|o\/)?\s?-?(\d{1,2})\s?(?:&|and)?\s?(?:u|under)\b/i.exec(s) || /\bu-?(\d{1,2})\b/i.exec(s) || /\bunder\s?-?(\d{1,2})\b/i.exec(s);
    if (m) { const a = 'U' + Number(m[1]); if (AGES.includes(a)) return a; }
    m = /\b(?:m|w|masters?\s?)(30|35|40|45|50|55|60|65|70|75|80)\+?\b/i.exec(s) || /\b(30|35|40|45|50|55|60|65|70|75|80)\+/.exec(s);
    if (m) return 'M' + m[1];
    if (/\bmasters?|veterans?\b/i.test(s)) return 'Masters';
    if (/\bpara\b|\bT\d{2}\b|\bF\d{2}\b/i.test(s)) return 'Para';
    if (/\bsenior|snr\b/i.test(s)) return 'Senior';
    if (/\bjunior|jnr\b/i.test(s)) return 'U20';
    if (/\byouth\b/i.test(s)) return 'U18';
    return '';
  }
  function parseDiscipline(s) {
    const t = ' ' + String(s || '').toLowerCase().replace(/metres?|meters?|meter|mtrs?/g, 'm').replace(/kilometres?|kilometers?/g, 'km').replace(/(\d)\s+(m|km)\b/g, '$1$2').replace(/[,.'’]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const has = w => new RegExp(`\\b${w}\\b`).test(t);
    const relay = /\b4\s?x\s?(\d+)m?\b/.exec(t);
    if (relay) { const d = byName(`4x${relay[1]}m Relay`); if (d) return d.name; }
    if (has('medley') || has('swedish')) return 'Medley Relay';
    if (has('shuttle')) return 'Shuttle Hurdles Relay';
    if (has('half marathon')) return 'Half Marathon';
    if (has('marathon')) return 'Marathon';
    if (has('cross country') || has('xc')) return 'Cross Country';
    if (has('mile') && !/\d+m\b/.test(t)) return 'Mile';
    const field = DISCIPLINES.filter(d => d.kind === 'field').find(d => (d.words || []).some(w => w.length > 2 && has(w)));
    if (field) return field.name;
    const m = /\b(\d{2,5})(m|km)(?=\b|h\b|sc\b)/.exec(t) || /\b(\d{2,5})\s*(?=h\b|hurdles|steeple|sc\b|walk|run|dash|race|$|\s)/.exec(t);
    if (!m) { const f2 = DISCIPLINES.filter(d => d.kind === 'field').find(d => (d.words || []).some(w => has(w))); return f2 ? f2.name : ''; }
    const metres = m[2] === 'km' ? Number(m[1]) * 1000 : Number(m[1]);
    if (has('hurdles') || has('h') || /\d+mh\b/.test(t)) { const d = DISCIPLINES.find(x => x.hurdles && x.metres === metres); if (d) return d.name; }
    if (has('steeple') || has('steeplechase') || has('sc') || /\d+msc\b/.test(t)) { const d = DISCIPLINES.find(x => x.steeple && x.metres === metres); if (d) return d.name; }
    if (has('walk') || has('rw')) { const d = DISCIPLINES.find(x => x.walk && x.metres === metres) || DISCIPLINES.find(x => x.walk && x.metres === metres && x.road); if (d) return d.name; }
    if (m[2] === 'km') { const d = DISCIPLINES.find(x => x.road && !x.walk && x.metres === metres); if (d) return d.name; }
    const d = DISCIPLINES.find(x => !x.hurdles && !x.steeple && !x.walk && !x.relay && !x.road && x.metres === metres);
    if (d) return d.name;
    return '';
  }
  function parseRound(s) {
    const t = String(s || '');
    let m = /\b(heat|race)\s*#?\s*(\d+)/i.exec(t); if (m) return { round: m[1].toLowerCase() === 'race' ? 'Race' : 'Heat', heat: m[2] };
    m = /\b(semi[- ]?finals?|sf)\s*#?\s*(\d+)?/i.exec(t); if (m) return { round: 'Semi-final', heat: m[2] || '' };
    m = /\b(quarter[- ]?finals?|qf)\s*#?\s*(\d+)?/i.exec(t); if (m) return { round: 'Quarter-final', heat: m[2] || '' };
    m = /\b([ab])\s*final\b/i.exec(t); if (m) return { round: m[1].toUpperCase() + ' Final', heat: '' };
    if (/\btimed\s*finals?\b/i.test(t)) return { round: 'Timed final', heat: '' };
    if (/\bfinals?\b/i.test(t)) return { round: 'Final', heat: '' };
    m = /\bqualif\w*\s*(?:group)?\s*([a-d1-4])?/i.exec(t); if (m) return { round: 'Qualification', heat: m[1] ? (/\d/.test(m[1]) ? m[1] : String(m[1].toUpperCase().charCodeAt(0) - 64)) : '' };
    if (/\bheats?\b|\bprelim/i.test(t)) return { round: 'Heat', heat: '' };
    return { round: '', heat: '' };
  }
  /** Reads a name from a timing system or a start list: { gender, age, discipline, round, heat, kind, wind } (empty when not found) */
  function parseEvent(text) {
    const s = String(text || '');
    const gender = (GENDER_WORDS.find(([re]) => re.test(s)) || [])[1] || '';
    const discipline = parseDiscipline(s);
    const d = byName(discipline);
    return Object.assign({ gender, age: parseAge(s), discipline, kind: d ? d.kind : '', windEvent: !!(d && d.wind) }, parseRound(s));
  }
  /** Lane and heat numbers for the dropdowns */
  const LANES = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const HEATS = Array.from({ length: 20 }, (_, i) => String(i + 1));

  const Athletics = { GENDERS, AGES, DISCIPLINES, ROUNDS, NUMBERED, ROLES, NOTES, LANES, HEATS, byName, eventName, roundLabel, parseEvent, parseDiscipline, parseAge, parseRound,
    groups: () => [...new Set(DISCIPLINES.map(d => d.group))].map(g => ({ group: g, list: DISCIPLINES.filter(d => d.group === g) })) };
  if (typeof module !== 'undefined' && module.exports) module.exports = Athletics; else window.Athletics = Athletics;
})();
