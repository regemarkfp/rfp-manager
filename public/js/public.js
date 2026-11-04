/* The public website (/, /c/<channel>, /matches, /videos, /subscriptions): what is live now, coming up, the videos,
 * matches and channels of every production team, laid out like a video site. Production teams work in /app. */
'use strict';
// a ticket / pass link (?ticket=tk_…) is kept for the watch pages of this website
try { const t = new URLSearchParams(location.search).get('ticket'); if (/^tk_/.test(t || '')) { const k = 'rfp-tickets', l = JSON.parse(localStorage.getItem(k) || '[]'); localStorage.setItem(k, JSON.stringify([t, ...l.filter((x) => x !== t)].slice(0, 30))); } } catch (e) { /* private window */ }
(() => {
  // replaceChildren / append skip empty parts (null, undefined, false)
  for (const P of [Element.prototype, DocumentFragment.prototype]) for (const name of ['replaceChildren', 'append']) { const orig = P[name]; P[name] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); }; }
  // links from inside the app to the old addresses (/#/edit/…, /?next=…) belong to the app
  if (/^#\//.test(location.hash) || new URLSearchParams(location.search).has('next')) { location.replace('/app' + location.search + location.hash); return; }

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k);
    return e;
  };
  const img = (id) => (!id ? '' : /^https?:/.test(id) ? id : '/media/' + encodeURIComponent(id));
  const esc = (s) => String(s || '');
  let D = null, CH = null, query = '';

  const ago = (iso) => {
    const t = Date.parse(iso); if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']].find(([n]) => s >= n);
    if (!u) return 'just now';
    const n = Math.floor(s / u[0]); return `${n} ${u[1]}${n === 1 ? '' : 's'} ago`;
  };
  const dur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const day = (d, t) => { if (!d) return ''; const x = new Date(d + 'T' + (t || '12:00')); const today = new Date().toISOString().slice(0, 10); const tm = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
    return (d === today ? 'Today' : d === tm ? 'Tomorrow' : x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })) + (t ? ' · ' + t : ''); };
  const avatar = (src, name, cls = 'avatar') => (src ? el('img', { class: cls, src: img(src), alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: cls }, String(name || '?').trim().slice(0, 1).toUpperCase()));
  const match = (q, ...texts) => !q || texts.join(' ').toLowerCase().includes(q);

  // ---- cards
  function thumb(item, badges) {
    const ch = item.channel || {};
    const bg = item.poster ? img(item.poster) : ch.banner ? img(ch.banner) : '';
    return el('div', { class: 'thumb', style: { backgroundImage: bg ? `url("${bg}")` : `linear-gradient(135deg, ${ch.color || '#00ff82'}55, #151515 70%)` } },
      !bg && ch.logo ? el('img', { class: 'logo', src: img(ch.logo), alt: '' }) : !bg ? el('div', { class: 'thumb-name' }, ch.name || '') : null, badges);
  }
  function streamCard(s, opts = {}) {
    const href = '/watch/' + s.slug + (s.match ? '?m=' + encodeURIComponent(s.match) : s.start ? '?v=' + encodeURIComponent(s.start) : '');
    const badges = s.live ? el('span', { class: 'badge live' }, '● LIVE') : s.start ? el('span', { class: 'badge dur' }, dur(s.duration)) : el('span', { class: 'badge when' }, day(s.date, s.time));
    const sub = s.live ? `${s.viewers || 0} watching` : s.start ? (s.of ? s.of + ' · ' : '') + ago(s.start) : 'Upcoming · ' + day(s.date, s.time);
    const price = s.price && s.price.ticket ? el('span', { class: 'badge price' }, 'R ' + Number(s.price.ticket).toFixed(2).replace(/\.00$/, '')) : null;
    return el('a', { class: 'card', href }, thumb(s, [badges, price]),
      el('div', { class: 'meta' }, opts.noChannel ? null : el('a', { href: '/c/' + s.channel.slug, 'data-nav': '' }, avatar(s.channel.logo, s.channel.name, 'chlogo')),
        el('div', {}, el('b', {}, s.title), el('div', { class: 'sub' }, opts.noChannel ? '' : s.channel.name, opts.noChannel ? null : el('br'), sub))));
  }
  function matchCard(m) {
    const live = m.status === 'Live';
    const team = (t) => el('div', { class: 'row' }, t.logo ? el('img', { src: img(t.logo), alt: '' }) : el('span', { class: 'ph', style: { background: t.color || '#555' } }), el('span', {}, t.name));
    const open = (e) => { if (e.target.closest('a')) return; history.pushState(null, '', '/match/' + encodeURIComponent(m.id)); window.scrollTo(0, 0); render(); };
    return el('div', { class: 'match clickable', role: 'link', tabindex: '0', title: 'Match centre: score, stats and line-ups', onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(e); } },
      el('div', { class: 'top-line' }, el('span', {}, m.competition ? m.competition.name : m.sport), live ? el('span', { class: 'status-live' }, '● LIVE' + (m.period ? ' · ' + m.period : '')) : el('span', {}, m.status === 'Completed' ? 'Full time' : day(m.date, m.time))),
      team(m.teams[0] || { name: 'Home' }), team(m.teams[1] || { name: 'Away' }),
      m.score ? el('div', { class: 'score' }, m.score) : null,
      el('div', { class: 'foot' }, [m.venue, m.company].filter(Boolean).join(' · ')),
      m.watch ? el('a', { class: 'watch-btn' + (m.watch.live ? ' live' : ''), href: m.watch.href }, m.watch.live ? '● Watch live' : '▶ Watch the match') : null,
      live || m.score ? el('div', { class: 'more' }, live ? 'Live stats ›' : 'Match stats ›') : null);
  }
  // ---- following teams and clubs: match updates in the app, the browser and the inbox
  const following = (id) => !!(D && D.me && (D.me.follows || []).includes(id));
  const say = (t) => { const n = el('div', { class: 'toast' }, t); document.body.append(n); setTimeout(() => n.remove(), 3500); };
  // PayFast: start a payment (the server makes the signed form) and go there
  async function payGo(url, body = {}) {
    const r = await post(url, body);
    const f = el('form', { method: 'POST', action: r.url, style: 'display:none' });
    for (const [k, v] of r.fields) f.append(el('input', { type: 'hidden', name: k, value: v }));
    document.body.append(f); f.submit();
  }
  // back from PayFast (?paid=<id>): wait for PayFast's confirmation, then say so and show the page again
  function paidNotice(onPaid) {
    const id = new URLSearchParams(location.search).get('paid');
    if (!id) return null;
    const box = el('div', { class: 'push-inline' }, el('span', {}, '⏳ Waiting for PayFast to confirm your payment…'));
    let n = 0;
    const tick = async () => {
      let s = null;
      try { s = await get('/api/pay/status/' + encodeURIComponent(id)); } catch { s = null; }
      if (s && s.status === 'Paid') { box.replaceChildren(el('span', {}, `✓ Payment received${s.item ? ': ' + s.item : ''}. A receipt is on its way by email. Thank you!`)); history.replaceState(null, '', location.pathname); if (onPaid) setTimeout(onPaid, 1500); return; }
      if (s && ['Failed', 'Cancelled'].includes(s.status)) { box.replaceChildren(el('span', {}, 'The payment did not go through. Nothing was charged; you can try again.')); return; }
      if (++n < 40) setTimeout(tick, 3000); else box.replaceChildren(el('span', {}, 'PayFast has not confirmed it yet. If you paid, it will show here shortly (refresh the page).'));
    };
    tick();
    return box;
  }
  // after the first follow: offer notifications in this browser (the app registers itself)
  async function offerPush() {
    const N = window.RFPNotifyUI;
    if (!N || N.native) return;
    const st = await N.webState().catch(() => 'unsupported');
    if (st !== 'off' && st !== 'unsupported') return;
    const old = document.getElementById('push-offer'); if (old) old.remove();
    const box = el('div', { id: 'push-offer', class: 'push-offer' },
      el('div', {}, el('b', {}, 'Get match updates on this device?'), el('div', { class: 'sub' }, st === 'unsupported' ? (/iPhone|iPad/.test(navigator.userAgent) ? 'On an iPhone: Share → Add to Home Screen, then open the site from there.' : 'This browser cannot show notifications. The RFP Manager app for Android can.') : 'Line-ups, kick-off, scores, half time and full time for the teams you follow.')),
      st === 'off' ? el('button', { class: 'primary', onclick: async () => { try { if (await N.enableWeb()) { box.remove(); say('Notifications are on'); } } catch (e) { say(e.message); } } }, 'Turn on') : null,
      el('button', { class: 'icon', 'aria-label': 'Not now', onclick: () => box.remove() }, '✕'));
    document.body.append(box);
  }
  async function toggleFollow(id, on, alerts) {
    if (!D.me) { signIn('Sign in to follow teams and clubs and get their match updates.'); return null; }
    const r = await post('/api/public/follow', { id, follow: on, alerts });
    D.me.follows = r.follows.map((f) => f.id);
    if (on) { say('Following – you get its match updates'); if (D.me.follows.length === 1 || !alerts) offerPush(); }
    side();
    return r;
  }
  function followBtn(id, { small } = {}) {
    const b = el('button', { class: 'follow' + (following(id) ? ' on' : '') + (small ? ' sm' : ''), onclick: async (e) => {
      e.stopPropagation(); e.preventDefault();
      const on = !following(id);
      try { const r = await toggleFollow(id, on); if (r) { b.className = 'follow' + (on ? ' on' : '') + (small ? ' sm' : ''); b.textContent = on ? '★ Following' : '☆ Follow'; if (!small) render(); } } catch (err) { say(err.message); }
    } }, following(id) ? '★ Following' : '☆ Follow');
    return b;
  }
  const teamLogo = (t, cls = 'tlogo') => (t.logo ? el('img', { class: cls, src: img(t.logo), alt: '' }) : el('span', { class: cls + ' ph', style: { background: t.color || '#555' } }, String(t.name || '?').slice(0, 1)));
  function teamCard(t) {
    const go = (e) => { if (e.target.closest('button')) return; history.pushState(null, '', '/team/' + encodeURIComponent(t.id)); window.scrollTo(0, 0); render(); };
    return el('div', { class: 'tcard', role: 'link', tabindex: '0', onclick: go, onkeydown: (e) => { if (e.key === 'Enter') go(e); } }, teamLogo(t),
      el('div', { class: 'grow' }, el('b', {}, t.name), el('div', { class: 'sub' }, t.kind === 'competition' ? ['Competition', t.sport, t.company].filter(Boolean).join(' · ') : t.kind === 'club' ? ['Club', t.company].filter(Boolean).join(' · ') : [t.clubName && t.clubName !== t.name ? t.clubName : '', t.sport, t.gender].filter(Boolean).join(' · '))),
      followBtn(t.id, { small: true }));
  }
  function teamsPage() {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    get('/api/public/teams').then((c) => {
      const q = query, f = (list) => list.filter((t) => match(q, t.name, t.clubName, t.sport, t.company));
      const clubs = f(c.clubs), teams = f(c.teams), comps = f(c.competitions || []);
      box.replaceChildren(el('p', { class: 'sub', style: { margin: '0 0 8px' } }, 'Follow a club (all its teams) or one team to get its line-ups, kick-off, scores, half time and full time on your phone.'),
        section('Competitions', comps.length ? el('div', { class: 'tgrid' }, comps.map(teamCard)) : null, comps.length),
        section('Clubs', clubs.length ? el('div', { class: 'tgrid' }, clubs.map(teamCard)) : null, clubs.length),
        section('Teams', teams.length ? el('div', { class: 'tgrid' }, teams.map(teamCard)) : null, teams.length),
        !clubs.length && !teams.length ? el('div', { class: 'empty' }, q ? 'No team matches your search.' : 'No teams to follow yet.') : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    return [el('h2', { class: 'sec' }, 'Teams & clubs'), box];
  }
  // one followed team: what (the alerts), how often (live or digest only, how often scores come) — saved as it changes
  function alertsEditor(id, ch, follow) {
    const cur = { alerts: { ...(follow.alerts || {}) }, live: follow.live !== false, digest: follow.digest !== false, scoreRate: follow.scoreRate || 'every' };
    const save = async () => { try { await post('/api/public/follow', { id, follow: true, ...cur }); } catch (err) { say(err.message); } };
    const kinds = el('div', { class: 'alerts-kinds' });
    const paint = () => kinds.replaceChildren(el('span', { class: 'sub' }, 'Tell me about:'), ch.alertKinds.map((k) => el('label', {}, el('input', { type: 'checkbox', disabled: !cur.live ? '' : null, checked: cur.alerts[k.key] !== false ? '' : null, onchange: (e) => { cur.alerts[k.key] = e.target.checked; rate.disabled = !cur.live || !cur.alerts.scores; save(); } }), k.label)));
    const rate = el('select', { onchange: (e) => { cur.scoreRate = e.target.value; save(); } }, ch.scoreRates.map((r) => el('option', { value: r.key, selected: r.key === cur.scoreRate ? '' : null }, r.label)));
    rate.disabled = !cur.live || cur.alerts.scores === false;
    const mode = el('select', { onchange: (e) => { cur.live = e.target.value !== 'digest'; cur.digest = e.target.value !== 'live'; rate.disabled = !cur.live || cur.alerts.scores === false; paint(); save(); } },
      [['both', 'As it happens + in my digest'], ['live', 'As it happens only'], ['digest', 'Only in my digest']].map(([v, l]) => el('option', { value: v, selected: (cur.live && cur.digest ? 'both' : cur.live ? 'live' : 'digest') === v ? '' : null }, l)));
    paint();
    return el('div', { class: 'alerts' }, el('div', { class: 'arow' }, el('label', {}, el('span', { class: 'sub' }, 'Updates'), mode), el('label', {}, el('span', { class: 'sub' }, 'Scores'), rate)), kinds);
  }
  // how often overall: the score digest (off / match days / daily / weekly, at a time, with fixtures, by push / email) and a pause
  function rhythmCard(prefs, ch) {
    const p = { ...prefs, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
    const save = async () => { try { const r = await fetch('/api/public/follow-prefs', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify(p) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Not saved'); Object.assign(p, j.prefs); paint(); } catch (e) { say(e.message); } };
    const box = el('div', { class: 'alerts rhythm' });
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function paint() {
      const off = p.digest === 'off', paused = p.pausedUntil > Date.now();
      box.replaceChildren(
        el('div', { class: 'arow' }, el('b', {}, 'Score digest'), el('select', { onchange: (e) => { p.digest = e.target.value; save(); } }, ch.digests.map((d) => el('option', { value: d.key, selected: d.key === p.digest ? '' : null }, d.label))),
          off ? null : [p.digest === 'weekly' ? el('select', { onchange: (e) => { p.day = Number(e.target.value); save(); } }, days.map((d, i) => el('option', { value: i, selected: i === p.day ? '' : null }, 'on ' + d))) : null,
            el('label', {}, el('span', { class: 'sub' }, 'at'), el('input', { type: 'time', value: p.time, onchange: (e) => { if (e.target.value) { p.time = e.target.value; save(); } } }))]),
        off ? el('div', { class: 'sub' }, 'A digest sums up your teams\' results (and what is coming up) once a day or week, at the time you choose.') : el('div', { class: 'arow' },
          el('label', {}, el('input', { type: 'checkbox', checked: p.fixtures ? '' : null, onchange: (e) => { p.fixtures = e.target.checked; save(); } }), 'Include coming fixtures'),
          el('label', {}, el('input', { type: 'checkbox', checked: p.push ? '' : null, onchange: (e) => { p.push = e.target.checked; save(); } }), 'As a notification'),
          el('label', {}, el('input', { type: 'checkbox', checked: p.email ? '' : null, onchange: (e) => { p.email = e.target.checked; save(); } }), 'By email'),
          el('button', { class: 'sm', onclick: async () => { try { const r = await post('/api/public/digest/now', {}); say(r.sent ? 'Digest sent' : 'Nothing to report for your teams right now'); } catch (e) { say(e.message); } } }, 'Send me one now')),
        el('div', { class: 'arow' }, el('b', {}, 'Pause live updates'),
          paused ? [el('span', {}, 'Paused until ' + new Date(p.pausedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })), el('button', { class: 'sm', onclick: () => { p.pausedUntil = 0; save(); } }, 'Resume')]
            : [['1 hour', 3600e3], ['Until tomorrow', 'tomorrow'], ['1 week', 7 * 86400e3]].map(([l, ms]) => el('button', { class: 'sm', onclick: () => { const t = new Date(); if (ms === 'tomorrow') { t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0); p.pausedUntil = t.getTime(); } else p.pausedUntil = Date.now() + ms; save(); } }, l))),
        el('div', { class: 'sub' }, 'Digests go out on your device\'s time zone (' + (p.tz || 'not set') + '). Quiet hours under Notifications still apply.'));
    }
    paint();
    if (!prefs.tz || prefs.tz !== p.tz) save();                 // keep the time zone of the device in use
    return box;
  }
  function teamPage(id) {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    get('/api/public/team/' + encodeURIComponent(id)).then((t) => {
      document.title = `${t.name} – ${D.site || 'RegemarkFP'}`;
      const M = t.matches;
      box.replaceChildren(
        el('div', { class: 'thead' }, teamLogo(t, 'tlogo big'), el('div', { class: 'grow' }, el('h1', {}, t.name),
          el('div', { class: 'sub' }, [t.kind === 'competition' ? 'Competition' : t.kind === 'club' ? 'Club' : t.clubName && t.clubName !== t.name ? t.clubName : '', t.sport, t.company, `${t.followers} follower${t.followers === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            t.kind === 'team' && t.club ? [' · ', el('a', { href: '/team/' + encodeURIComponent(t.club), 'data-nav': '' }, 'Club page')] : null)), followBtn(t.id)),
        t.following && t.follow ? alertsEditor(t.id, t, t.follow) : null,
        t.table && t.table.length ? section('Log', el('div', { class: 'tablewrap' }, el('table', { class: 'log' }, el('thead', {}, el('tr', {}, ['#', 'Team', 'P', 'W', 'D', 'L', 'PD', 'Pts'].map((x) => el('th', {}, x)))),
          el('tbody', {}, t.table.map((r, i) => el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, el('a', { href: '/team/' + encodeURIComponent(r.id), 'data-nav': '' }, r.name)), ...[r.P, r.W, r.D, r.L, r.PD, r.Pts].map((x, j) => el('td', { class: j === 5 ? 'pts' : '' }, String(x))))))))) : null,
        section('Live', M.live.length ? el('div', { class: 'matches' }, M.live.map(matchCard)) : null),
        section('Fixtures', M.upcoming.length ? el('div', { class: 'matches' }, M.upcoming.map(matchCard)) : null),
        section('Results', M.results.length ? el('div', { class: 'matches' }, M.results.map(matchCard)) : null),
        t.teams && t.teams.length ? section('Teams', el('div', { class: 'tgrid' }, t.teams.map(teamCard)), t.teams.length) : null,
        !M.live.length && !M.upcoming.length && !M.results.length ? el('div', { class: 'empty' }, 'No matches yet.') : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.status === 404 ? 'This team is not on the website.' : e.message)));
    return [el('div', { class: 'match-head' }, el('a', { href: '/teams', 'data-nav': '' }, '‹ Teams & clubs')), box];
  }
  function followingPage() {
    if (!D.me) return el('div', { class: 'signin-box' }, el('h2', {}, 'Following'), el('p', {}, 'Sign in to follow teams and clubs and get their line-ups, kick-off, scores, half time and full time.'), signInButton());
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    const pushBox = el('div', {});
    if (window.RFPNotifyUI && !window.RFPNotifyUI.native) window.RFPNotifyUI.webState().then((st) => pushBox.replaceChildren(st === 'on' ? null : el('div', { class: 'push-inline' },
      el('span', {}, st === 'blocked' ? 'Notifications are blocked in this browser: allow them in the site settings.' : st === 'unsupported' ? 'This browser cannot show notifications (on an iPhone, add the site to your home screen first).' : 'Turn on notifications to get the updates on this device.'),
      st === 'off' ? el('button', { class: 'primary', onclick: async () => { if (await window.RFPNotifyUI.enableWeb().catch((e) => { say(e.message); return false; })) { say('Notifications are on'); pushBox.replaceChildren(); } } }, 'Turn on') : null))).catch(() => {});
    get('/api/public/follows').then((r) => {
      box.replaceChildren(el('h3', { class: 'sec2' }, 'How often'), rhythmCard(r.prefs, r),
        el('h3', { class: 'sec2' }, 'Your teams'),
        r.list.length ? r.list.map((t) => el('div', { class: 'frow' }, teamCard(t), alertsEditor(t.id, r, t)))
          : el('div', { class: 'empty' }, 'You do not follow any team yet. ', el('a', { href: '/teams', 'data-nav': '' }, 'Find your teams'), '.'),
        r.muted.length ? el('p', { class: 'sub' }, `${r.muted.length} match${r.muted.length === 1 ? ' is' : 'es are'} muted (open a match to unmute it).`) : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    return [el('div', { class: 'spread' }, el('h2', { class: 'sec' }, 'Following'), el('a', { href: '/teams', 'data-nav': '' }, el('button', {}, '+ Find teams'))), pushBox, box,
      el('p', { class: 'sub' }, el('button', { class: 'sm', onclick: async () => { try { const r = await get('/api/public/ical-link'); window.location.href = r.webcal; setTimeout(() => { navigator.clipboard && navigator.clipboard.writeText(r.url).catch(() => {}); say('Calendar link copied too (for Google Calendar: Other calendars → From URL)'); }, 600); } catch (e) { say(e.message); } } }, '📅 Add my teams\' fixtures to my calendar')),
      el('p', { class: 'sub' }, 'Quiet hours and the rest of your notifications: ', el('a', { href: '/notifications', 'data-nav': '' }, 'Notifications'), '.')];
  }

  // ---- software (/software, /software/<app>): RegemarkFP's apps, downloads from this server
  const myOs = () => { const u = navigator.userAgent; return /Windows/.test(u) ? 'windows' : /Mac OS X|Macintosh/.test(u) && !/iPhone|iPad/.test(u) ? 'mac' : /Linux|X11/.test(u) && !/Android/.test(u) ? 'linux' : ''; };
  const OS = { windows: 'Windows', mac: 'macOS', linux: 'Linux', other: 'Other' };
  const mb = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(0.1, n / 1048576).toFixed(1) + ' MB');
  function appCard(p) {
    const r = p.releases[0];
    return el('a', { class: 'tcard app', href: '/software/' + p.slug, 'data-nav': '' }, p.logo ? el('img', { class: 'tlogo', src: img(p.logo), alt: '' }) : el('span', { class: 'tlogo ph', style: { background: 'var(--accent)', color: '#111' } }, p.name.slice(0, 1)),
      el('div', { class: 'grow' }, el('b', {}, p.name), el('div', { class: 'sub' }, p.tagline || ''), el('div', { class: 'sub' }, [r ? 'Version ' + r.version : 'Coming soon', r ? [...new Set(r.assets.map((a) => OS[a.platform]))].join(' · ') : '', p.price ? 'R ' + p.price : 'Free'].filter(Boolean).join(' · '))));
  }
  function softwarePage() {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    get('/api/public/software').then((r) => box.replaceChildren(r.list.length ? el('div', { class: 'tgrid' }, r.list.map(appCard)) : el('div', { class: 'empty' }, 'No apps yet.'))).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    return [el('h2', { class: 'sec' }, 'Software'), el('p', { class: 'sub', style: { margin: '-4px 0 12px' } }, 'Our own broadcast and production tools.'), box];
  }
  function appPage(slug) {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    get('/api/public/software/' + encodeURIComponent(slug)).then((p) => {
      document.title = `${p.name} – ${D.site || 'RegemarkFP'}`;
      const r = p.releases[0], os = myOs();
      const mine = r ? r.assets.filter((a) => a.platform === os) : [];
      const dl = (a, primary) => p.canDownload ? el('a', { class: 'dl' + (primary ? ' primary' : ''), href: a.url }, `⬇ ${OS[a.platform]}${a.arch ? ' (' + a.arch + ')' : ''} · .${a.kind}`, el('span', { class: 'sub' }, ' ' + mb(a.size)))
        : el('span', { class: 'dl off' }, `${OS[a.platform]} · .${a.kind}`);
      box.replaceChildren(paidNotice(() => render()) || '',
        el('div', { class: 'thead' }, p.logo ? el('img', { class: 'tlogo big', src: img(p.logo), alt: '' }) : el('span', { class: 'tlogo big ph', style: { background: 'var(--accent)', color: '#111' } }, p.name.slice(0, 1)),
          el('div', { class: 'grow' }, el('h1', {}, p.name), el('div', { class: 'sub' }, [p.tagline, r ? `Version ${r.version} · ${new Date(r.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '', p.price ? 'R ' + p.price : 'Free'].filter(Boolean).join(' · ')))),
        !r ? el('div', { class: 'empty' }, 'The first release is coming soon.') : [
          !p.canDownload ? el('div', { class: 'push-inline' }, el('span', {}, `${p.name} costs R ${Number(p.price).toFixed(2)}. Buy it once and download it on your account any time.`),
            p.payments ? el('button', { class: 'primary', onclick: async (e) => { if (!D.me) return signIn(`Sign in to buy ${p.name}: it is kept on your account.`); e.target.disabled = true; try { await payGo(`/api/public/software/${encodeURIComponent(slug)}/buy`); } catch (x) { say(x.message); e.target.disabled = false; } } }, `Buy · R ${Number(p.price).toFixed(2)}`) : el('span', { class: 'sub' }, ' Buying it here is coming soon.')) : null,
          el('div', { class: 'dls' }, mine.length ? mine.map((a, i) => dl(a, i === 0)) : null, r.assets.filter((a) => a.platform !== os).map((a) => dl(a, !mine.length && false))),
          os && !mine.length ? el('p', { class: 'sub' }, `No ${OS[os]} version yet.`) : null],
        p.description ? el('div', { class: 'desc-box' }, p.description) : null,
        r && r.notes ? [el('h2', { class: 'sec' }, `What's new in ${r.version}`), el('div', { class: 'desc-box' }, r.notes)] : null,
        p.releases.length > 1 ? [el('h2', { class: 'sec' }, 'Earlier versions'), el('div', {}, p.releases.slice(1).map((x) => el('details', { class: 'rel' }, el('summary', {}, `${x.version} · ${new Date(x.publishedAt).toLocaleDateString('en-GB')}`),
          el('div', { class: 'dls' }, x.assets.map((a) => dl(a))), x.notes ? el('div', { class: 'desc-box' }, x.notes) : null)))] : null,
        p.repo ? el('p', { class: 'sub' }, 'Also on GitHub: ', el('a', { href: `https://github.com/${p.repo}/releases`, target: '_blank', rel: 'noopener' }, p.repo)) : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.status === 404 ? 'No such app.' : e.message)));
    return [el('div', { class: 'match-head' }, el('a', { href: '/software', 'data-nav': '' }, '‹ Software')), box];
  }

  // ---- a client's page (/client/<key>): one production, shared by the production company
  function clientPage(key) {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    const zar = (n) => 'R ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 });
    const want = new URLSearchParams(location.search).get('pay');
    const payInvoice = async (x, btn, c) => {
      let email = c.clientEmail;
      if (!email) { email = prompt('Your email address (for the PayFast receipt):', '') || ''; if (!email) return; }
      btn.disabled = true;
      try { await payGo(x.pay, { email }); } catch (e) { say(e.message); btn.disabled = false; }
    };
    get('/api/client/' + encodeURIComponent(key)).then((c) => {
      document.title = `${c.name} – ${c.company}`;
      box.replaceChildren(paidNotice(() => render()) || '',el('div', { class: 'thead' }, c.logo ? el('img', { class: 'tlogo big', src: img(c.logo), alt: '' }) : null, el('div', { class: 'grow' }, el('div', { class: 'sub' }, c.company), el('h1', {}, c.name),
        el('div', { class: 'sub' }, [c.number, c.date + (c.days > 1 ? ` (${c.days} days)` : ''), c.txTime && 'TX ' + c.txTime, c.venue, c.status].filter(Boolean).join(' · ')))),
        c.description ? el('div', { class: 'desc-box' }, c.description) : null,
        el('div', { class: 'dls' }, el('a', { class: 'dl', href: c.callsheet, target: '_blank', rel: 'noopener' }, 'Call sheet (PDF)'), c.report ? el('a', { class: 'dl', href: c.report, target: '_blank', rel: 'noopener' }, 'Production report (PDF)') : null, c.watch ? el('a', { class: 'dl primary', href: c.watch }, '● Live stream') : null),
        c.matches.length ? section('Matches', el('div', { class: 'up-list' }, c.matches.map((m) => el('a', { class: 'up-row', href: '/match/' + m.id }, el('div', { class: 'what' }, el('b', {}, m.name), el('span', { class: 'sub' }, [m.date, m.status].filter(Boolean).join(' · '))))))) : null,
        c.videos.length ? section('Recordings', el('div', { class: 'up-list' }, c.videos.map((v) => el('a', { class: 'up-row', href: v.url }, el('div', { class: 'what' }, el('b', {}, new Date(v.start).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), el('span', { class: 'sub' }, dur(v.duration))), el('span', { class: 'go' }, '▶'))))) : null,
        c.invoices.length ? section('Quotes & invoices', el('div', { class: 'up-list' }, c.invoices.map((x) => el('div', { class: 'up-row' + (want === x.number && x.pay ? ' hl' : '') },
          el('a', { class: 'what', href: x.url, target: '_blank', rel: 'noopener', style: { color: 'inherit', textDecoration: 'none' } }, el('b', {}, `${x.kind === 'quote' ? 'Quote' : 'Invoice'} ${x.number}`), el('span', { class: 'sub' }, `${x.date} · ${x.state} · ${zar(x.total)}`)),
          x.pay ? el('button', { class: 'primary sm', onclick: (e) => payInvoice(x, e.target, c) }, `Pay ${zar(x.total)}`) : el('a', { class: 'go', href: x.url, target: '_blank', rel: 'noopener' }, 'PDF'))))) : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    return box;
  }
  // ---- a booking followed by the client (/track/<key>): its steps, like a parcel, and the conversation
  function trackPage(key) {
    const box = el('div', { class: 'track' }, el('div', { class: 'empty' }, 'Loading…'));
    const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    const fmt = (d) => { const t = new Date(String(d) + 'T12:00:00Z'); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
    let timer = null, notice = null;
    const paint = (t) => {
      document.title = `Your booking – ${t.company}`;
      notice = notice || paidNotice(() => load().catch(() => {}));
      const ta = el('textarea', { rows: 3, placeholder: 'Ask us anything or add something about your booking…', maxlength: 3000 });
      const err = el('p', { class: 'err' });
      const sendBtn = el('button', { class: 'primary' }, 'Send');
      sendBtn.onclick = async () => {
        if (!ta.value.trim()) return;
        sendBtn.disabled = true; err.textContent = '';
        try { paint(await post(`/api/public/track/${encodeURIComponent(key)}/message`, { text: ta.value })); } catch (e) { err.textContent = e.message; sendBtn.disabled = false; }
      };
      box.replaceChildren(notice || '',
        el('div', { class: 'thead' }, t.logo ? el('img', { class: 'tlogo big', src: img(t.logo), alt: '' }) : null,
          el('div', { class: 'grow' }, el('div', { class: 'sub' }, `${t.company} · booking ${t.ref}`), el('h1', {}, t.service || 'Your booking'),
            el('div', { class: 'sub' }, [t.date && fmt(t.date), t.venue].filter(Boolean).join(' · ')))),
        el('div', { class: 'track-now' + (t.ended ? ' ended' : '') }, el('b', {}, t.stage), el('span', {}, t.say)),
        el('ol', { class: 'track-steps' }, t.steps.map((s) => el('li', { class: (s.done ? 'done' : '') + (s.now ? ' now' : '') + (t.ended && s.now ? ' ended' : '') },
          el('span', { class: 'dot' }), el('div', {}, el('b', {}, s.stage), el('span', { class: 'sub' }, s.at ? when(s.at) : s.done ? '' : s.say))))),
        t.deposit ? el('div', { class: 'track-now' + (t.deposit.paid ? '' : ' due'), style: { margin: '0 0 14px' } }, t.deposit.paid ? [el('b', { style: { fontSize: '17px' } }, `✓ Deposit of R ${t.deposit.amount.toFixed(2)} paid`), el('span', {}, when(t.deposit.at))]
          : [el('b', { style: { fontSize: '17px' } }, `Deposit: R ${t.deposit.amount.toFixed(2)}`), el('span', {}, 'Pay it to confirm your booking.'),
            t.deposit.pay ? el('div', {}, el('button', { class: 'primary pay-btn', onclick: async (e) => { e.target.disabled = true; try { await payGo(`/api/public/track/${encodeURIComponent(key)}/pay`); } catch (x) { say(x.message); e.target.disabled = false; } } }, `Pay R ${t.deposit.amount.toFixed(2)} with PayFast`)) : null]) : null,
        t.client || t.docs.length ? el('div', { class: 'dls' }, t.client ? el('a', { class: 'dl primary', href: t.client }, 'Your production page ›') : null,
          t.docs.map((x) => [el('a', { class: 'dl', href: x.url, target: '_blank', rel: 'noopener' }, `${x.kind === 'quote' ? 'Quote' : 'Invoice'} ${x.number} (PDF)${x.paid ? ' ✓ paid' : ''}`),
            x.pay ? el('button', { class: 'dl primary', onclick: async (e) => { e.target.disabled = true; try { await payGo(x.pay, {}); } catch (err) { say(err.message); e.target.disabled = false; } } }, `Pay invoice ${x.number} · R ${Number(x.total).toFixed(2)}`) : null])) : null,
        section('Messages', el('div', { class: 'chat' }, t.messages.length ? t.messages.map((m) => el('div', { class: 'msg ' + (m.from === 'client' ? 'me' : 'them') + (m.stage ? ' step' : '') },
          el('div', { class: 'sub' }, `${m.by} · ${when(m.at)}`), el('div', { class: 'body' }, m.text))) : el('p', { class: 'sub' }, 'No messages yet. We will write to you here, by email and on WhatsApp.'),
          el('div', { class: 'chat-send' }, ta, el('div', { class: 'row' }, sendBtn, err)))));
    };
    const load = () => get('/api/public/track/' + encodeURIComponent(key)).then(paint);
    load().catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    timer = setInterval(() => { if (!document.body.contains(box)) return clearInterval(timer); if (!box.querySelector('textarea') || !box.querySelector('textarea').value) load().catch(() => {}); }, 60000);
    return box;
  }
  // ---- a player's profile (/player/<id>), for teams that switch them on
  function playerPage(id) {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    get('/api/public/player/' + encodeURIComponent(id)).then((p) => {
      document.title = `${p.name} – ${D.site || 'RegemarkFP'}`;
      const st = Object.entries(p.stats || {});
      box.replaceChildren(el('div', { class: 'thead' }, p.image ? el('img', { class: 'tlogo big', src: img(p.image), alt: '', style: { borderRadius: '50%', objectFit: 'cover' } }) : el('span', { class: 'tlogo big ph', style: { background: '#444', borderRadius: '50%' } }, p.name.slice(0, 1)),
        el('div', { class: 'grow' }, el('h1', {}, p.name), el('div', { class: 'sub' }, [p.position, ...p.teams.map((t) => `${t.name}${t.number ? ' #' + t.number : ''}`)].filter(Boolean).join(' · ')))),
        el('div', { class: 'tgrid' }, el('div', { class: 'tcard' }, el('div', {}, el('div', { class: 'sub' }, 'Matches'), el('b', { style: { fontSize: '26px' } }, String(p.matches)))),
          st.map(([k, v]) => el('div', { class: 'tcard' }, el('div', {}, el('div', { class: 'sub' }, k), el('b', { style: { fontSize: '26px' } }, String(v)))))),
        p.recent.length ? section('Recent matches', el('div', { class: 'up-list' }, p.recent.map((m) => el('a', { class: 'up-row', href: '/match/' + m.id, 'data-nav': '' }, el('div', { class: 'what' }, el('b', {}, m.name), el('span', { class: 'sub' }, [m.date, m.score].filter(Boolean).join(' · '))))))) : null);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.status === 404 ? 'This player has no public profile.' : e.message)));
    return box;
  }
  // ---- the fans' corner under a match: predictions before kick-off, player of the match from the start of play
  function fanZone(id) {
    const box = el('div', { class: 'fanzone' });
    const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
    const load = () => get(`/api/public/match/${encodeURIComponent(id)}/fans`).then(paint).catch(() => box.replaceChildren());
    const vote = async (b) => { if (!D.me) return signIn('Sign in to have your say.'); try { paint(await post(`/api/public/match/${encodeURIComponent(id)}/fans`, b)); } catch (e) { say(e.message); } };
    function paint(f) {
      const P = f.predict, Q = f.potm;
      const opt = (k, label) => el('button', { class: 'vote' + (P.mine === k ? ' on' : ''), disabled: !P.open ? '' : null, onclick: () => vote({ predict: k }) }, el('b', {}, label), P.total ? el('span', { class: 'sub' }, ` ${pct(P.counts[k], P.total)}%`) : null);
      box.replaceChildren(el('h2', { class: 'sec' }, 'Fans'),
        el('div', { class: 'fz-row' }, el('div', { class: 'sub' }, P.open ? 'Who wins? (closes at kick-off)' : `Fans predicted (${P.total})`), el('div', { class: 'votes' }, opt('A', f.teams[0] || 'Home'), opt('D', 'Draw'), opt('B', f.teams[1] || 'Away'))),
        Q.open || Q.total ? el('div', { class: 'fz-row' }, el('div', { class: 'sub' }, Q.open ? `Player of the match: your vote${Q.total ? ` · ${Q.total} so far` : ''}` : `Fans' player of the match (${Q.total} votes)`),
          Q.leader ? el('p', {}, '🏅 ', el('b', {}, (Q.options.find((o) => o.key === Q.leader[0]) || {}).name || ''), ` · ${pct(Q.leader[1], Q.total)}%`) : null,
          Q.open ? el('select', { onchange: (e) => { if (e.target.value) vote({ potm: e.target.value }); } }, el('option', { value: '' }, Q.mine ? 'Change your vote…' : 'Pick a player…'), Q.options.map((o) => el('option', { value: o.key, selected: o.key === Q.mine ? '' : null }, `${o.name} (${o.team})`))) : null) : null);
    }
    load();
    return box;
  }

  // ---- the match centre (/match/<id>): score, what happened, team stats, players or the cricket scorecard
  let centre = null;
  function matchPage(id) {
    const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
    const m = [...(D.matches.live || []), ...(D.matches.upcoming || []), ...(D.matches.results || [])].find((x) => x.id === id);
    const head = el('div', { class: 'match-head' }, el('a', { href: '/matches', 'data-nav': '' }, '‹ Matches'),
      m && m.watch ? el('a', { class: 'watch-btn' + (m.watch.live ? ' live' : ''), href: m.watch.href }, m.watch.live ? '● Watch live' : '▶ Watch the match') : null);
    const muted = () => !!(D.me && (D.me.muted || []).includes(id));
    const muteBtn = D.me ? el('button', { class: 'follow sm' + (muted() ? '' : ' on'), title: 'Stop or start the updates of this match, whoever you follow', onclick: async (e) => {
      try { const on = !muted(); await post('/api/public/mute', { fixture: id, mute: on }); D.me.muted = on ? [...(D.me.muted || []), id] : (D.me.muted || []).filter((x) => x !== id); e.target.textContent = on ? '🔕 Muted' : '🔔 Updates on'; e.target.className = 'follow sm' + (on ? '' : ' on'); say(on ? 'No more updates about this match' : 'Updates for this match are back on'); } catch (err) { say(err.message); }
    } }, muted() ? '🔕 Muted' : '🔔 Updates on') : null;
    const fol = m && (m.teamIds || []).some(Boolean) ? el('div', { class: 'follow-row' }, (m.teamIds || []).map((tid, i) => (tid ? el('span', { class: 'fchip' }, el('a', { href: '/team/' + encodeURIComponent(tid), 'data-nav': '' }, (m.teams[i] || {}).name || 'Team'), followBtn(tid, { small: true })) : null)),
      D.me && (D.me.follows || []).length ? muteBtn : null) : null;
    if (centre) centre.stop();
    centre = window.MatchStats ? window.MatchStats.mount(box, id, { onMissing: () => box.replaceChildren(el('div', { class: 'empty' }, 'This match is not on the website.')), onData: (x) => { document.title = `${x.teams.map((t) => t.name).join(' v ')} – ${D.site || 'RegemarkFP'}`; } }) : null;
    return [head, box, fol, fanZone(id)];
  }
  // the channel's next stream (live now, or the next one coming up)
  const nextOf = (c) => {
    if (!D) return null;
    const l = (D.live || []).find((x) => x.channel.id === c.id);
    if (l) return el('span', { class: 'next live' }, '● LIVE');
    const u = (D.upcoming || []).find((x) => x.channel.id === c.id);
    return u ? el('span', { class: 'next' }, 'Next: ' + day(u.date, u.time)) : null;
  };
  const chanChip = (c) => el('a', { class: 'chan', href: '/c/' + c.slug, 'data-nav': '' }, c.logo ? el('img', { src: img(c.logo), alt: '' }) : el('span', { class: 'ph', style: { background: `linear-gradient(135deg, ${c.color}, #222)` } }, c.name.slice(0, 1)), el('b', {}, c.name), el('span', { class: 'sub' }, c.owner === 'Production company' ? c.company : c.owner), nextOf(c));
  const section = (title, kids, count) => (kids && (!Array.isArray(kids) || kids.length) ? [el('h2', { class: 'sec' }, title, count ? el('span', { class: 'count' }, count) : null), kids] : []);

  // ---- pages
  const videosOf = (list) => list.map((v) => ({ ...v, live: false }));
  function home() {
    const q = query;
    const live = D.live.filter((s) => match(q, s.title, s.channel.name));
    const up = D.upcoming.filter((s) => match(q, s.title, s.channel.name));
    const vids = videosOf(D.videos).filter((s) => match(q, s.title, s.channel.name));
    const mLive = D.matches.live.filter((m) => match(q, m.name, m.competition && m.competition.name, m.teams.map((t) => t.name).join(' ')));
    const mUp = D.matches.upcoming.filter((m) => match(q, m.name, m.competition && m.competition.name, m.teams.map((t) => t.name).join(' '))).slice(0, 8);
    const mRes = D.matches.results.filter((m) => match(q, m.name, m.competition && m.competition.name, m.teams.map((t) => t.name).join(' '))).slice(0, 8);
    const chans = D.channels.filter((c) => match(q, c.name, c.company));
    const first = live[0];
    const out = [
      first ? [el('h2', { class: 'sec' }, el('span', { style: { color: 'var(--live)' } }, '●'), 'Live now'),
        el('div', { class: 'hero' }, el('a', { href: '/watch/' + first.slug }, thumb(first, el('span', { class: 'badge live' }, '● LIVE'))),
          el('div', {}, el('a', { href: '/c/' + first.channel.slug, 'data-nav': '', style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' } }, avatar(first.channel.logo, first.channel.name, 'chlogo'), el('b', {}, first.channel.name)),
            el('h3', {}, first.title), el('div', { class: 'sub' }, `${first.viewers || 0} watching now`), el('p', {}, el('a', { href: '/watch/' + first.slug }, el('button', { class: 'primary' }, '▶ Watch'))))),
        live.length > 1 ? el('div', { class: 'grid', style: { marginTop: '18px' } }, live.slice(1).map((s) => streamCard(s))) : null] : null,
      section(mLive.length ? 'Live matches' : '', mLive.length ? el('div', { class: 'matches' }, mLive.map(matchCard)) : null),
      section('Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((s) => streamCard(s))) : null),
      section('Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 24).map((s) => streamCard(s))) : null, vids.length > 24 ? el('a', { href: '/videos', 'data-nav': '' }, 'See all ' + vids.length) : ''),
      section('Fixtures', mUp.length ? el('div', { class: 'matches' }, mUp.map(matchCard)) : null),
      section('Results', mRes.length ? el('div', { class: 'matches' }, mRes.map(matchCard)) : null),
      section('Channels', chans.length ? el('div', { class: 'chans' }, chans.map(chanChip)) : null),
    ];
    const any = live.length + up.length + vids.length + mLive.length + mUp.length + mRes.length + chans.length;
    return any ? out : el('div', { class: 'empty' }, q ? 'Nothing matches your search.' : 'Nothing to show yet. Live streams, videos and matches appear here.');
  }
  function videosPage() {
    const vids = videosOf(D.videos).filter((s) => match(query, s.title, s.channel.name));
    return [el('h2', { class: 'sec' }, 'Videos'), vids.length ? el('div', { class: 'grid' }, vids.map((s) => streamCard(s))) : el('div', { class: 'empty' }, 'No videos yet.')];
  }
  function matchesPage() {
    const f = (list) => list.filter((m) => match(query, m.name, m.competition && m.competition.name, m.teams.map((t) => t.name).join(' ')));
    const L = f(D.matches.live), U = f(D.matches.upcoming), R = f(D.matches.results);
    return L.length + U.length + R.length ? [section('Live', L.length ? el('div', { class: 'matches' }, L.map(matchCard)) : null), section('Fixtures', U.length ? el('div', { class: 'matches' }, U.map(matchCard)) : null), section('Results', R.length ? el('div', { class: 'matches' }, R.map(matchCard)) : null)]
      : el('div', { class: 'empty' }, 'No matches to show.');
  }
  function channelsPage() {
    const c = D.channels.filter((x) => match(query, x.name, x.company));
    return [el('h2', { class: 'sec' }, 'Channels'), c.length ? el('div', { class: 'chans', style: { flexWrap: 'wrap' } }, c.map(chanChip)) : el('div', { class: 'empty' }, 'No channels yet.')];
  }
  function subscriptionsPage() {
    if (!D.me) return el('div', { class: 'signin-box' }, el('h2', {}, 'Your subscriptions'), el('p', {}, 'Sign in to subscribe to channels and see their streams and videos here. Channels email you when they go live.'), signInButton());
    const subs = new Set(D.me.subscriptions || []);
    const mine = (s) => subs.has(s.channel.id);
    const live = D.live.filter(mine), up = D.upcoming.filter(mine), vids = videosOf(D.videos).filter(mine);
    const chans = D.channels.filter((c) => subs.has(c.id));
    if (!chans.length) return el('div', { class: 'signin-box' }, el('h2', {}, 'No subscriptions yet'), el('p', {}, 'Open a channel and press Subscribe.'), el('div', { class: 'chans', style: { justifyContent: 'center', flexWrap: 'wrap' } }, D.channels.map(chanChip)));
    return [section('Live now', live.length ? el('div', { class: 'grid' }, live.map((s) => streamCard(s))) : null), section('Coming up', up.length ? el('div', { class: 'grid' }, up.map((s) => streamCard(s))) : null),
      section('Latest videos', vids.length ? el('div', { class: 'grid' }, vids.map((s) => streamCard(s))) : null), section('Your channels', el('div', { class: 'chans' }, chans.map(chanChip)))];
  }
  async function channelPage(slug, tab) {
    let c;
    try { c = await get('/api/public/c/' + encodeURIComponent(slug)); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    CH = c;
    const ch = c.channel;
    document.title = ch.name + ' · ' + (D.site || 'RegemarkFP');
    const live = c.streams.filter((s) => s.live), today = new Date().toISOString().slice(0, 10);
    const up = c.streams.filter((s) => !s.live && (s.date ? s.date >= today : !s.videos.length)).sort((a, b) => String(a.date + a.time || '9').localeCompare(String(b.date + b.time || '9')));
    const vids = [];
    for (const s of c.streams) {
      for (const m of s.matches || []) if (m.duration > 0) vids.push({ ...s, live: false, title: m.title, of: s.title, match: m.fixture, start: m.start, duration: m.duration });
      for (const v of s.videos) vids.push({ ...s, live: false, title: s.title + ((s.matches || []).length ? ' (full stream)' : ''), start: v.start, duration: v.duration });
    }
    vids.sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const sub = el('button', { class: 'primary' + (c.subscribed ? ' on' : ''), onclick: () => subscribe(ch.id, !c.subscribed) }, c.subscribed ? 'Subscribed ✓' : 'Subscribe');
    const t = tab || 'home';
    const tabLink = (k, label) => el('a', { href: `/c/${ch.slug}${k === 'home' ? '' : '?tab=' + k}`, 'data-nav': '', class: t === k ? 'on' : '' }, label);
    const upRow = (s) => el('a', { class: 'up-row', href: '/watch/' + s.slug }, el('div', { class: 'when' }, el('b', {}, s.date ? day(s.date, '') : 'Date to follow'), el('span', {}, s.time || '')),
      el('div', { class: 'what' }, el('b', {}, s.title), el('span', { class: 'sub' }, s.price && s.price.ticket ? 'Ticket R ' + Number(s.price.ticket).toFixed(2).replace(/\.00$/, '') : 'Free to watch')), el('span', { class: 'go' }, 'Watch page ›'));
    const sermonsBox = () => {
      const box = el('div', {}, el('div', { class: 'empty' }, 'Loading…'));
      let q = '';
      const load = () => get(`/api/public/c/${encodeURIComponent(ch.slug)}/sermons?q=${encodeURIComponent(q)}`).then((r) => box.replaceChildren(
        el('input', { class: 'sermon-q', type: 'search', placeholder: 'Search title, preacher, scripture or series', value: q, onchange: (e) => { q = e.target.value; load(); } }),
        r.list.length ? el('div', { class: 'up-list' }, r.list.map((x) => el('a', { class: 'up-row', href: x.url }, el('div', { class: 'when' }, el('b', {}, x.date ? day(x.date, '') : ''), el('span', {}, x.duration ? dur(x.duration) : '')),
          el('div', { class: 'what' }, el('b', {}, x.title), el('span', { class: 'sub' }, [x.preacher, x.scripture, x.series].filter(Boolean).join(' · ')), x.notes ? el('span', { class: 'sub', style: { display: 'block', whiteSpace: 'pre-wrap' } }, x.notes.slice(0, 220)) : null), el('span', { class: 'go' }, '▶ Watch'))))
          : el('div', { class: 'empty' }, q ? 'No sermon matches.' : 'No sermons yet. Services with a recording show up here.'))).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
      load();
      return box;
    };
    const body = t === 'sermons' ? sermonsBox() : t === 'upcoming' ? (up.length ? [el('div', { class: 'up-list' }, up.map(upRow)), c.subscribed ? null : el('p', { class: 'sub' }, 'Subscribe to get an email when a stream starts.')] : el('div', { class: 'empty' }, 'Nothing scheduled yet.'))
      : t === 'about' ? el('div', { class: 'about' }, ch.description || 'No description yet.', el('p', {}, `${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${ch.owner === 'Production company' ? 'by ' + ch.company : ch.owner + ' channel · ' + ch.company}`))
      : t === 'videos' ? (vids.length ? el('div', { class: 'grid' }, vids.map((s) => streamCard(s, { noChannel: true }))) : el('div', { class: 'empty' }, 'No videos yet.'))
        : [section('Live now', live.length ? el('div', { class: 'grid' }, live.map((s) => streamCard(s, { noChannel: true }))) : null), section('Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((s) => streamCard(s, { noChannel: true }))) : null),
          section('Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 12).map((s) => streamCard(s, { noChannel: true }))) : null), !live.length && !up.length && !vids.length ? el('div', { class: 'empty' }, 'Nothing here yet.') : null];
    return [el('div', { class: 'banner', style: { backgroundImage: ch.banner ? `url("${img(ch.banner)}")` : `linear-gradient(120deg, ${ch.color}, #151515 75%)` } }),
      el('div', { class: 'chead' }, ch.logo ? el('img', { class: 'big', src: img(ch.logo), alt: '' }) : el('span', { class: 'big avatar', style: { fontSize: '44px' } }, ch.name.slice(0, 1)),
        el('div', { style: { flex: 1, minWidth: '200px' } }, el('h1', {}, ch.name), el('div', { class: 'sub' }, `/c/${ch.slug} · ${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${vids.length} video${vids.length === 1 ? '' : 's'}`)), sub),
      el('div', { class: 'tabs' }, tabLink('home', 'Home'), tabLink('upcoming', 'Upcoming' + (up.length ? ` (${up.length})` : '')), tabLink('videos', 'Videos'), ch.owner === 'Church' || /church|kerk|gemeente|ministr/i.test(ch.name + ' ' + (ch.company || '')) || t === 'sermons' ? tabLink('sermons', 'Sermons') : null, tabLink('about', 'About')), body];
  }

  // ---- the landing page: about us, Browse content, Book services, sign in as a production team
  let L = null;
  async function landingData() { if (!L) L = await get('/api/public/landing'); return L; }
  async function landingPage() {
    let l;
    try { l = await landingData(); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = l.site || 'RegemarkFP';
    const live = (D.live || [])[0];
    const team = () => { if (D.me && D.me.teams) location.href = '/app'; else signIn('Production team members: sign in to open your Studio.'); };
    return [
      el('section', { class: 'land-hero', style: l.image ? { backgroundImage: `linear-gradient(90deg, rgba(10,10,10,.92) 35%, rgba(10,10,10,.55)), url("${img(l.image)}")` } : {} },
        el('img', { class: 'land-logo', src: '/brand/rfp-logo.png', alt: l.site || '' }),
        el('h1', {}, l.title), el('p', { class: 'land-about' }, l.about),
        el('div', { class: 'land-buttons' }, el('a', { class: 'btn-big primary', href: '/browse', 'data-nav': '' }, 'Browse content'), el('a', { class: 'btn-big', href: '/book', 'data-nav': '' }, 'Book services')),
        el('a', { class: 'land-team', href: '#', onclick: (e) => { e.preventDefault(); team(); } }, D.me && D.me.teams ? 'Open your Studio (production team) ›' : 'Sign in as production team')),
      live ? el('a', { class: 'land-live', href: '/watch/' + live.slug }, el('span', { class: 'badge live', style: { position: 'static' } }, '● LIVE'), el('b', {}, live.title), el('span', { class: 'sub' }, live.channel.name + ' · watch now ›')) : null,
      (l.services || []).length ? [el('h2', { class: 'sec' }, 'What we do'), el('div', { class: 'land-services' }, l.services.map((x) => el('a', { class: 'svc', href: '/book?service=' + encodeURIComponent(x.title), 'data-nav': '' }, el('b', {}, x.title), el('p', {}, x.text || ''), el('span', { class: 'more' }, 'Book ›'))))] : null,
      l.email || l.phone ? el('p', { class: 'land-contact' }, 'Contact us: ', l.email ? el('a', { href: 'mailto:' + l.email }, l.email) : null, l.email && l.phone ? ' · ' : '', l.phone ? el('a', { href: 'tel:' + l.phone.replace(/\s+/g, '') }, l.phone) : null) : null];
  }
  async function bookPage(service) {
    let l;
    try { l = await landingData(); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = 'Book services · ' + (l.site || 'RegemarkFP');
    const f = { name: D.me ? D.me.name : '', email: D.me ? D.me.email : '', phone: '', organisation: '', service, date: '', venue: '', details: '', website: '' };
    const input = (k, label, attrs = {}) => el('label', { class: 'fld' }, el('span', {}, label), el(attrs.rows ? 'textarea' : 'input', { ...attrs, value: f[k] || '', oninput: (e) => { f[k] = e.target.value; } }));
    const opts = (l.services || []).map((x) => x.title);
    const sel = el('select', { onchange: (e) => { f.service = e.target.value; } }, el('option', { value: '' }, 'Choose…'), opts.map((o) => el('option', { value: o, selected: o === service ? '' : null }, o)), el('option', { value: 'Something else' }, 'Something else'));
    const err = el('p', { class: 'err' });
    const box = el('div', { class: 'book' });
    const btn = el('button', { class: 'primary', type: 'submit' }, 'Send request');
    const form = el('form', { class: 'book-form', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      try { if (form.querySelector('textarea')) f.details = form.querySelector('textarea').value; const r = await post('/api/public/booking', f);
        box.replaceChildren(el('h1', {}, 'Thank you'), el('p', { class: 'sub' }, 'We have your request and will be in touch soon.' + (f.email ? ' A copy is on its way to ' + f.email + ', with the link to follow your booking.' : '')),
          r && r.track ? el('p', {}, el('a', { class: 'btn-big', href: r.track, 'data-nav': '' }, 'Follow your booking ›'), ' ', el('span', { class: 'sub' }, 'Keep this link: it shows where your booking stands, and you can send us a message there.')) : null,
          el('a', { class: 'btn-big', href: '/', 'data-nav': '' }, 'Back to the home page'));
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    } },
      input('name', 'Your name *', { required: '', autocomplete: 'name' }), input('organisation', 'Organisation / club / church', { autocomplete: 'organization' }),
      input('email', 'Email', { type: 'email', autocomplete: 'email' }), input('phone', 'Phone (WhatsApp)', { type: 'tel', autocomplete: 'tel' }),
      el('label', { class: 'fld' }, el('span', {}, 'Service'), sel), input('date', 'Date of the event', { type: 'date' }), input('venue', 'Where', {}),
      el('label', { class: 'fld wide' }, el('span', {}, 'Tell us about it'), el('textarea', { rows: 5, placeholder: 'What is the event, how many cameras or what you would like streamed, graphics, anything else…' })),
      el('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', oninput: (e) => { f.website = e.target.value; } }),
      err, el('div', { class: 'wide' }, btn));
    box.append(el('h1', {}, 'Book services'), el('p', { class: 'sub' }, 'Tell us about your event and we will get back to you with a quote.'), form);
    return box;
  }

  // ---- signing in and subscribing
  // Everyone signs in here with Google and stays on the website (subscriptions, tickets). Members of a production
  // team are taken to the Studio (/app); nobody is asked to make a production team.
  let gsi = null, backTo = '';
  const loadGsi = () => gsi || (gsi = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Google sign-in could not load')); document.head.append(s); }));
  function signIn(why) {
    const old = document.getElementById('signin-modal'); if (old) old.remove();
    const holder = el('div', { style: { display: 'flex', justifyContent: 'center', minHeight: '44px' } }, el('span', { class: 'sub' }, 'Loading…'));
    const err = el('p', { class: 'err', style: { display: 'none' } });
    const close = () => wrap.remove();
    const wrap = el('div', { id: 'signin-modal', class: 'modal', onclick: (e) => { if (e.target === wrap) close(); } },
      el('div', { class: 'modal-box' }, el('button', { class: 'icon x', onclick: close, 'aria-label': 'Close' }, '✕'),
        el('img', { src: '/brand/rfp-logo-sm.png', alt: '', style: { height: '34px' } }), el('h2', {}, 'Sign in'),
        el('p', { class: 'sub' }, why || 'Subscribe to channels, keep your tickets and get an email when they go live.'), holder, err,
        el('p', { class: 'sub small' }, 'Production team members go to their Studio after signing in.')));
    document.body.append(wrap);
    if (!D.googleClientId) { holder.replaceChildren(el('span', { class: 'sub' }, 'Sign-in is not set up on this website yet.')); return; }
    if (window.RFPNative && window.RFPNative.signInWithGoogle) { holder.replaceChildren(el('button', { class: 'primary', onclick: () => window.RFPNative.signInWithGoogle(backTo ? new URL(backTo, location.href).pathname : location.pathname) }, 'Sign in with Google')); return; }
    loadGsi().then(() => {
      google.accounts.id.initialize({ client_id: D.googleClientId, callback: async (resp) => {
        holder.replaceChildren(el('span', { class: 'sub' }, 'Signing in…'));
        try {
          await post('/api/auth/google', { credential: resp.credential });
          D = await get('/api/public/home');
          if (backTo) { location.href = backTo; return; }
          if (D.me && D.me.teams) { location.href = '/app'; return; }
          close(); render();
        } catch (e) { err.textContent = e.message; err.style.display = ''; holder.replaceChildren(); }
      } });
      holder.replaceChildren();
      google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 300 });
    }).catch((e) => { holder.replaceChildren(el('span', { class: 'sub' }, e.message)); });
  }
  const signInButton = () => el('button', { class: 'primary', onclick: () => signIn() }, 'Sign in');
  async function signOut() { try { await post('/api/auth/logout', {}); } catch (e) { /* signed out anyway */ } D = await get('/api/public/home'); render(); }
  async function subscribe(id, on) {
    if (!D.me) { signIn('Sign in to subscribe. The channel emails you when it goes live.'); return; }
    try {
      const r = await post('/api/public/subscribe', { channel: id, on });
      D.me.subscriptions = r.subscriptions;
      render();
    } catch (e) { alert(e.message); }
  }

  // ---- data and routing
  async function get(url) { const r = await fetch(url, { credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status }); return j; }
  async function post(url, body) { const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }

  // notifications: the inbox and what to get (lib/push.js); live now for channels you subscribe to, match moments …
  function notificationsPage() {
    if (!D.me) return el('div', { class: 'signin-box' }, el('h2', {}, 'Notifications'), el('p', {}, 'Sign in to get notifications when the channels you subscribe to go live, and for the key moments of their matches.'), signInButton());
    const inbox = el('div', {}), set = el('div', {});
    if (window.RFPNotifyUI) { window.RFPNotifyUI.inbox(inbox, { limit: 30 }); window.RFPNotifyUI.settings(set); }
    return el('div', { style: { maxWidth: '760px', padding: '8px 4px' } }, el('h2', {}, 'Notifications'), inbox, el('h2', { style: { marginTop: '28px' } }, 'What you get'), set);
  }
  function side() {
    const p = location.pathname;
    const link = (href, label, icon) => el('a', { href, 'data-nav': '', class: p === href ? 'on' : '' }, el('span', {}, icon), label);
    const subs = D && D.me ? D.channels.filter((c) => (D.me.subscriptions || []).includes(c.id)) : [];
    $('side').replaceChildren(link('/', 'Home', '⌂'), link('/browse', 'Browse', '▦'), link('/book', 'Book services', '✉'), link('/matches', 'Matches', '◎'), link('/teams', 'Teams', '⚑'), link('/software', 'Software', '⬇'), D && D.me ? link('/following', 'Following' + ((D.me.follows || []).length ? ` (${D.me.follows.length})` : ''), '♥') : null, link('/videos', 'Videos', '▶'), link('/subscriptions', 'Subscriptions', '★'), link('/channels', 'Channels', '◉'),
      subs.length ? [el('hr'), el('h4', {}, 'Subscriptions'), subs.map((c) => el('a', { href: '/c/' + c.slug, 'data-nav': '', class: p === '/c/' + c.slug ? 'on' : '' }, c.logo ? el('img', { class: 'chip-logo', src: img(c.logo), alt: '' }) : el('span', { class: 'chip-logo' }), c.name))] : null,
      D && D.me && D.me.teams ? [el('hr'), el('a', { href: '/app', class: 'studio-link' }, el('span', {}, '⚙'), 'Studio (your production team)')] : null,
      D && !D.me ? [el('hr'), el('a', { href: '#', class: 'studio-link', onclick: (e) => { e.preventDefault(); signIn('Production team members: sign in to open your Studio.'); } }, el('span', {}, '⚙'), 'Production teams: sign in')] : null);
  }
  function meBox() {
    const m = D && D.me;
    let menu = null;
    const toggle = (e) => { e.stopPropagation(); if (menu) { menu.remove(); menu = null; return; }
      menu = el('div', { class: 'me-menu' }, el('div', { class: 'who' }, el('b', {}, m.name || ''), el('div', { class: 'sub' }, m.email)),
        m.teams ? el('a', { href: '/app' }, 'Studio') : null, el('a', { href: '/subscriptions', 'data-nav': '' }, 'Subscriptions'), el('a', { href: '/notifications', 'data-nav': '' }, 'Notifications'), el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); signOut(); } }, 'Sign out'));
      $('me').append(menu); document.addEventListener('click', () => { if (menu) { menu.remove(); menu = null; } }, { once: true }); };
    $('me').replaceChildren(m && m.teams ? el('a', { href: '/app' }, el('button', { class: 'studio' }, 'Studio')) : null,
      m ? el('button', { class: 'icon avatar-btn', title: m.email, onclick: toggle }, avatar(m.image, m.name || m.email)) : signInButton());
  }
  async function render() {
    side(); meBox();
    const p = location.pathname, params = new URLSearchParams(location.search);
    document.body.classList.toggle('landing', p === '/' || p === '');
    document.title = D.site || 'RegemarkFP';
    let view;
    if (centre && !p.startsWith('/match/')) { centre.stop(); centre = null; }
    if (p.startsWith('/client/')) view = clientPage(decodeURIComponent(p.slice(8).replace(/\/$/, '')));
    else if (p.startsWith('/track/')) view = trackPage(decodeURIComponent(p.slice(7).replace(/\/$/, '')));
    else if (p.startsWith('/player/')) view = playerPage(decodeURIComponent(p.slice(8).replace(/\/$/, '')));
    else if (p === '/software') view = softwarePage();
    else if (p.startsWith('/software/')) view = appPage(decodeURIComponent(p.slice(10).replace(/\/$/, '')));
    else if (p === '/teams') view = teamsPage();
    else if (p.startsWith('/team/')) view = teamPage(decodeURIComponent(p.slice(6).replace(/\/$/, '')));
    else if (p === '/following') view = followingPage();
    else if (p.startsWith('/match/')) view = matchPage(decodeURIComponent(p.slice(7).replace(/\/$/, '')));
    else if (p.startsWith('/c/')) view = await channelPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')), params.get('tab'));
    else if (p === '/videos') view = videosPage();
    else if (p === '/matches') view = matchesPage();
    else if (p === '/channels') view = channelsPage();
    else if (p === '/subscriptions') view = subscriptionsPage();
    else if (p === '/notifications') view = notificationsPage();
    else if (p === '/book') view = await bookPage(params.get('service') || '');
    else if (p === '/' || p === '') view = await landingPage();
    else view = home();
    $('main').replaceChildren(...[view].flat(Infinity).filter(Boolean));
    document.body.classList.remove('side-open');
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-nav]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target) return;
    e.preventDefault(); history.pushState(null, '', a.getAttribute('href')); window.scrollTo(0, 0); render();
  });
  window.addEventListener('popstate', render);
  $('menu').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('search').addEventListener('submit', (e) => { e.preventDefault(); query = e.target.querySelector('input').value.trim().toLowerCase(); if (!['/browse', '/videos', '/matches', '/channels', '/teams'].includes(location.pathname)) history.pushState(null, '', '/browse'); render(); });
  $('search').querySelector('input').addEventListener('input', (e) => { if (!e.target.value) { query = ''; render(); } });

  async function load() {
    try { D = await get('/api/public/home'); } catch (e) { $('main').replaceChildren(el('div', { class: 'empty' }, 'Cannot reach the website right now. ', el('a', { href: '/' }, 'Try again'))); return; }
    $('site-name').textContent = D.site || 'RegemarkFP';
    const sp = new URLSearchParams(location.search);
    const nx = sp.get('next') || '';
    if (/^\/(?!\/)[\w\-./?=&%]*$/.test(nx)) backTo = nx;
    if (sp.get('signin') === '1') { if (D.me && backTo) { location.replace(backTo); return; } if (!D.me) signIn(); }
    if (sp.has('signin')) { sp.delete('signin'); sp.delete('next'); history.replaceState(null, '', location.pathname + (sp.toString() ? '?' + sp : '')); }
    render();
  }
  load();
  setInterval(async () => { try { D = await get('/api/public/home'); if (!/^\/(c|match|team|software|client|player|track)\//.test(location.pathname) && !['/', '/book', '/teams', '/following', '/notifications', '/software'].includes(location.pathname)) render(); } catch (e) { /* next time */ } }, 30000);   // live now / viewers
})();
