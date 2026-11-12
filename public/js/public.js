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
  const img = (id) => (!id ? '' : /^(https?:|\/)/.test(id) ? id : '/media/' + encodeURIComponent(id));
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
    const href = s.href || '/watch/' + s.slug + (s.match ? '?m=' + encodeURIComponent(s.match) : s.start ? '?v=' + encodeURIComponent(s.start) : '');
    const badges = s.live ? el('span', { class: 'badge live' }, '● LIVE') : s.start ? (s.duration > 0 ? el('span', { class: 'badge dur' }, dur(s.duration)) : s.youtube ? el('span', { class: 'badge dur' }, 'YouTube') : null) : el('span', { class: 'badge when' }, day(s.date, s.time));
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
  // ---- the client portal (/portal/<key>): quotes to sign, invoices to pay, productions, bookings, adverts, colleagues
  function portalPage(key) {
    const box = el('div', { class: 'portal' }, el('div', { class: 'empty' }, 'Loading…'));
    const base = '/api/portal/' + encodeURIComponent(key);
    const zar = (n) => 'R' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const want = new URLSearchParams(location.search).get('doc');
    let opened = false;
    const del = async (url) => { const r = await fetch(url, { method: 'DELETE', credentials: 'same-origin', headers: { 'x-rfp': '1' } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };
    const modal = (title, ...kids) => { const wrap = el('div', { class: 'modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } }, el('div', { class: 'modal-box', style: { maxWidth: '560px' } }, el('button', { class: 'icon x', onclick: () => wrap.remove(), 'aria-label': 'Close' }, '✕'), el('h2', {}, title), ...kids)); document.body.append(wrap); return wrap; };
    // signing a quote: a popup with the terms, the name, and a signature drawn with finger or mouse or loaded as a
    // picture. It is kept as the contract (with the terms as they are now); the quote PDF itself stays clean.
    function signQuote(x, after, terms) {
      const cv = el('canvas', { width: 520, height: 170, class: 'sign-pad' });
      const ctx = cv.getContext('2d');
      let drawn = false, down = false, mode = 'draw';
      const clear = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.strokeStyle = '#0b1b3a'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawn = false; };
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
      cv.addEventListener('pointerdown', (e) => { if (mode !== 'draw') return; down = true; cv.setPointerCapture(e.pointerId); const [px, py] = at(e); ctx.beginPath(); ctx.moveTo(px, py); e.preventDefault(); });
      cv.addEventListener('pointermove', (e) => { if (!down) return; const [px, py] = at(e); ctx.lineTo(px, py); ctx.stroke(); drawn = true; e.preventDefault(); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => cv.addEventListener(k, () => { down = false; }));
      clear();
      // a picture of a signature: fitted onto the white pad, so what is kept is always the same size
      const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onchange: () => {
        const fl = file.files[0]; if (!fl) return;
        if (fl.size > 5 * 1024 * 1024) { err.textContent = 'Pictures can be up to 5 MB.'; err.style.display = ''; return; }
        const im = new Image();
        im.onload = () => { clear(); const sc = Math.min((cv.width - 20) / im.width, (cv.height - 20) / im.height); const w = im.width * sc, hh = im.height * sc; ctx.drawImage(im, (cv.width - w) / 2, (cv.height - hh) / 2, w, hh); drawn = true; mode = 'upload'; paintTabs(); URL.revokeObjectURL(im.src); };
        im.onerror = () => { err.textContent = 'That picture could not be read.'; err.style.display = ''; };
        im.src = URL.createObjectURL(fl); file.value = '';
      } });
      const tabDraw = el('button', { type: 'button', class: 'sm', onclick: () => { mode = 'draw'; clear(); paintTabs(); } }, 'Draw');
      const tabLoad = el('button', { type: 'button', class: 'sm', onclick: () => file.click() }, 'Load a picture');
      const paintTabs = () => { tabDraw.className = 'sm' + (mode === 'draw' ? ' primary' : ''); tabLoad.className = 'sm' + (mode === 'upload' ? ' primary' : ''); };
      paintTabs();
      const f = { name: '', agree: false, ack: false };
      const ackText = (terms && terms.acknowledge) || '';
      const err = el('p', { class: 'err', style: { display: 'none' } });
      const docTerms = x.terms || (terms && terms.docTerms) || '', cond = (terms && terms.conditions) || '';
      const btn = el('button', { class: 'primary', onclick: async () => {
        err.style.display = 'none';
        if (f.name.trim().length < 2) { err.textContent = 'Type your full name.'; err.style.display = ''; return; }
        if (!drawn) { err.textContent = 'Sign in the white box, or load a picture of your signature.'; err.style.display = ''; return; }
        if (!f.agree) { err.textContent = 'Tick that you accept the quote and the terms and conditions.'; err.style.display = ''; return; }
        if (ackText && !f.ack) { err.textContent = 'Tick that you have read the clauses pointed out.'; err.style.display = ''; return; }
        btn.disabled = true;
        try { await post(x.sign, { name: f.name, agree: true, acknowledged: f.ack, method: mode, image: cv.toDataURL('image/png') }); wrap.remove(); say('Signed. Thank you: the production is confirmed. Your signed contract is with the quote.'); after(); } catch (e) { err.textContent = e.message; err.style.display = ''; btn.disabled = false; }
      } }, 'Sign the contract');
      const wrap = modal(`Sign quote ${x.number}`,
        el('p', { class: 'sub' }, `${x.title ? x.title + ' · ' : ''}${zar(x.total)}. `, el('a', { href: x.pdf, target: '_blank', rel: 'noopener' }, 'Read the quote (PDF)')),
        docTerms || cond ? el('div', { class: 'terms-box' }, docTerms ? [el('b', {}, 'Quote terms'), el('p', {}, docTerms)] : null, cond ? [el('b', {}, 'Terms and conditions'), el('div', { class: 'pre' }, cond)] : null) : null,
        el('label', { class: 'fld' }, el('span', {}, 'Your full name'), el('input', { autocomplete: 'name', oninput: (e) => { f.name = e.target.value; } })),
        el('div', { class: 'fld' }, el('div', { class: 'row', style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' } }, el('span', { style: { flex: 1 } }, 'Your signature'), tabDraw, tabLoad), cv, file,
          el('button', { class: 'sm', type: 'button', onclick: () => { mode = 'draw'; clear(); paintTabs(); }, style: { marginTop: '6px' } }, 'Clear')),
        el('label', { class: 'row', style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '12px 0' } }, el('input', { type: 'checkbox', onchange: (e) => { f.agree = e.target.checked; } }), el('span', {}, 'I accept this quote and the terms and conditions above on behalf of the client. My signature is kept as our contract.')),
        ackText ? el('label', { class: 'row', style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '0 0 12px' } }, el('input', { type: 'checkbox', onchange: (e) => { f.ack = e.target.checked; } }), el('b', {}, ackText)) : null,
        err, btn);
    }
    // the account behind this link: sign in with Google, with a password, or create one
    function accountBox(c, after) {
      const me = c.me, acc = c.account;
      if (me.signedIn) return el('p', { class: 'sub small' }, `Signed in as ${me.email}. `, el('a', { href: '#', onclick: async (e) => { e.preventDefault(); await post('/api/auth/logout', {}).catch(() => {}); after(); } }, 'Sign out'));
      const pw = el('input', { type: 'password', autocomplete: acc.password ? 'current-password' : 'new-password', placeholder: acc.password ? 'Your password' : 'Choose a password (8+ characters)' });
      const err = el('p', { class: 'err', style: { display: 'none' } });
      const go = async () => {
        err.style.display = 'none';
        try { if (acc.password) await post('/api/auth/login', { email: me.email, password: pw.value }); else await post(`${base}/password`, { password: pw.value }); after(); }
        catch (e) { err.textContent = e.message; err.style.display = ''; }
      };
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return el('div', { class: 'portal-signin' },
        el('p', { class: 'sub', style: { marginTop: 0 } }, me.other ? `You are signed in as ${me.other}, not ${me.email}. ` : '', `Sign in as ${me.email} to keep your details up to date.`),
        el('div', { class: 'row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          acc.google || !acc.password ? el('button', { class: 'primary', onclick: () => { backTo = location.pathname; signIn(`Sign in with Google as ${me.email} to manage your client portal.`); } }, 'Sign in with Google') : null,
          acc.google ? null : [pw, el('button', { class: acc.google || !acc.password ? '' : 'primary', onclick: go }, acc.password ? 'Sign in' : 'Create password')]),
        err);
    }
    // the client's details (name, accounts email, phone, address, VAT …): shown on quotes and invoices
    function detailsBox(c, after) {
      const cl = c.client, f = { name: cl.name, email: cl.email, phone: cl.phone, website: cl.website, vatNo: cl.vatNo, regNo: cl.regNo, address: cl.address };
      const ro = !c.me.signedIn;
      const fld = (k, label, attrs = {}) => el('label', { class: 'fld' }, el('span', {}, label), el(k === 'address' ? 'textarea' : 'input', { value: f[k] || '', disabled: ro ? '' : null, rows: k === 'address' ? 3 : null, ...attrs, oninput: (e) => { f[k] = e.target.value; } }, k === 'address' ? f[k] || '' : null));
      const btn = ro ? null : el('button', { class: 'primary', onclick: async () => {
        btn.disabled = true;
        try { const r = await fetch(`${base}/details`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify(f) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); say(j.changed.length ? 'Saved: ' + j.changed.join(', ') + '. Your quotes and invoices show it.' : 'Nothing changed.'); after(); }
        catch (e) { say(e.message); btn.disabled = false; }
      } }, 'Save my details');
      return el('div', {}, accountBox(c, after),
        el('div', { class: 'portal-details' }, fld('name', 'Name (on quotes and invoices)'), fld('email', 'Accounts email', { type: 'email' }), fld('phone', 'Phone', { type: 'tel' }), fld('website', 'Website'),
          fld('vatNo', 'VAT number'), fld('regNo', 'Registration / ID number'), fld('address', 'Address')), btn);
    }
    function render2() {
      get(base).then((c) => {
        document.title = `${c.client.name} – client portal`;
        const quotesToSign = c.docs.filter((x) => x.sign);
        const row = (x) => el('div', { class: 'up-row' + (want === x.id ? ' hl' : ''), id: 'doc-' + x.id },
          el('div', { class: 'when' }, el('b', {}, x.number), el('span', {}, x.kind === 'quote' ? 'Quote' : 'Invoice')),
          el('a', { class: 'what', href: x.pdf, target: '_blank', rel: 'noopener', style: { color: 'inherit', textDecoration: 'none' } }, el('b', {}, x.title || (x.kind === 'quote' ? 'Quote' : 'Invoice') + ' ' + x.number),
            el('span', { class: 'sub' }, `${x.date} · ${x.state}${x.signed ? ` · signed by ${x.signed.name}` : ''} · ${zar(x.total)}${x.kind === 'invoice' && x.balance > 0 && x.balance !== x.total ? ` · ${zar(x.balance)} still due` : ''}`)),
          el('div', { class: 'row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } }, el('a', { class: 'dl', href: x.pdf, target: '_blank', rel: 'noopener' }, 'PDF'),
            x.contract ? el('a', { class: 'dl', href: x.contract, target: '_blank', rel: 'noopener' }, 'Contract') : null,
            x.sign ? el('button', { class: 'primary sm', onclick: () => signQuote(x, render2, c.terms) }, 'Sign') : null,
            x.pay ? el('button', { class: 'primary sm', onclick: async (e) => { e.target.disabled = true; try { await payGo(x.pay, {}); } catch (er) { say(er.message); e.target.disabled = false; } } }, `Pay ${zar(x.balance)}`) : null));
        const slot = (s) => {
          const f = { name: '', from: '' };
          const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hide', style: { display: 'none' }, onchange: async () => {
            const fl = file.files[0]; if (!fl) return;
            if (fl.size > 8 * 1024 * 1024) { say('Pictures can be up to 8 MB'); return; }
            try {
              const r = await fetch(`${base}/ads?slot=${encodeURIComponent(s.id)}&name=${encodeURIComponent(f.name || fl.name.replace(/\.\w+$/, ''))}&from=${encodeURIComponent(f.from)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': fl.type, 'x-rfp': '1' }, body: fl });
              const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load it');
              say(j.invoice ? `Thank you! Invoice ${j.invoice.number} (${zar(j.invoice.total)}) is below; your advert plays once it is approved.` : 'Thank you! Your advert plays once it is approved.');
              render2();
            } catch (e) { say(e.message); }
            file.value = '';
          } });
          return el('div', { class: 'svc slot' }, el('b', {}, s.name), el('span', { class: 'sub' }, [s.sport, s.layout, s.width && s.height ? `${s.width} × ${s.height} px` : '', s.seconds ? `${s.seconds} s on screen` : ''].filter(Boolean).join(' · ')),
            s.description ? el('p', { class: 'sub', style: { margin: '4px 0' } }, s.description) : null, s.formats ? el('p', { class: 'sub small', style: { margin: '2px 0' } }, s.formats) : null,
            el('div', { style: { fontWeight: 700, margin: '6px 0' } }, s.price ? `${zar(s.price)} per ${s.period || 'month'}` : 'Included'),
            el('input', { placeholder: 'Name of the advert (optional)', oninput: (e) => { f.name = e.target.value; } }),
            el('label', { class: 'sub small', style: { display: 'block', marginTop: '6px' } }, 'Start on ', el('input', { type: 'date', style: { width: 'auto' }, oninput: (e) => { f.from = e.target.value; } })),
            file, el('button', { class: 'primary sm', style: { marginTop: '8px' }, onclick: () => file.click() }, 'Upload your advert'));
        };
        const nu = { email: '', name: '' };
        box.replaceChildren(paidNotice(() => render2()) || '',
          el('div', { class: 'thead' }, c.client.logo ? el('img', { class: 'tlogo big', src: img(c.client.logo), alt: '' }) : el('span', { class: 'tlogo big ph', style: { background: 'var(--accent)', color: '#111' } }, c.client.name.slice(0, 1)),
            el('div', { class: 'grow' }, el('div', { class: 'sub' }, `Client portal · ${c.company.name}`), el('h1', {}, c.client.name), el('div', { class: 'sub' }, c.me.signedIn ? `Signed in as ${c.me.email}` : `Opened with your link as ${c.me.email}`))),
          quotesToSign.length || c.owed > 0 ? el('div', { class: 'push-inline' }, el('span', {}, [quotesToSign.length ? `${quotesToSign.length} quote${quotesToSign.length === 1 ? '' : 's'} to sign` : '', c.owed > 0 ? `${zar(c.owed)} owed` : ''].filter(Boolean).join(' · ') + '.'),
            quotesToSign.length ? el('button', { class: 'primary', onclick: () => signQuote(quotesToSign[0], render2, c.terms) }, 'Sign now') : null) : null,
          section('Quotes & invoices', c.docs.length ? el('div', { class: 'up-list' }, c.docs.map(row)) : el('p', { class: 'sub' }, 'Nothing yet.')),
          c.productions.length ? section('Productions', el('div', { class: 'up-list' }, c.productions.map((p) => el('a', { class: 'up-row', href: p.page, 'data-nav': '' }, el('div', { class: 'when' }, el('b', {}, p.date || ''), el('span', {}, p.number)), el('div', { class: 'what' }, el('b', {}, p.name), el('span', { class: 'sub' }, p.status)), el('span', { class: 'go' }, 'Open ›'))))) : null,
          c.bookings.length ? section('Bookings & reviews', el('div', { class: 'up-list' }, c.bookings.map((b) => el(b.track ? 'a' : 'div', { class: 'up-row', href: b.track || null, 'data-nav': b.track ? '' : null }, el('div', { class: 'when' }, el('b', {}, b.date || '')),
            el('div', { class: 'what' }, el('b', {}, b.service || 'Booking'), el('span', { class: 'sub' }, b.stage + (b.rating ? ` · you rated it ${'★'.repeat(b.rating.stars)}${b.rating.comment ? ': "' + b.rating.comment.slice(0, 80) + '"' : ''}` : ''))), el('span', { class: 'go' }, b.track ? 'Follow ›' : ''))))) : null,
          section('Your adverts', [
            c.ads.length ? el('div', { class: 'up-list', style: { marginBottom: '14px' } }, c.ads.map((a) => el('div', { class: 'up-row' }, a.image ? el('img', { src: img(a.image), alt: '', style: { width: '140px', maxHeight: '70px', objectFit: 'contain', background: '#222' } }) : el('span', {}),
              el('div', { class: 'what' }, el('b', {}, a.name), el('span', { class: 'sub' }, (c.slots.find((s) => s.id === a.slot) || {}).name || '')),
              el('div', { class: 'row', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, el('span', { class: 'chip' + (a.approval === 'Approved' ? ' on' : '') }, a.approval === 'Pending' ? 'Waiting for approval' : a.approval),
                a.approval !== 'Approved' ? el('button', { class: 'sm', onclick: async () => { if (!confirm('Remove this advert?')) return; try { await del(`${base}/ads/${encodeURIComponent(a.id)}`); render2(); } catch (e) { say(e.message); } } }, 'Remove') : null)))) : null,
            c.slots.length ? el('div', { class: 'svc-grid' }, c.slots.map(slot)) : el('p', { class: 'sub' }, 'No advert spaces are offered right now.')]),
          section('Your details', detailsBox(c, render2)),
          section('People on this portal', el('div', {}, el('div', { class: 'up-list' }, c.users.map((u) => el('div', { class: 'up-row' }, el('div', { class: 'when' }, el('b', {}, u.name || '')), el('div', { class: 'what' }, el('b', {}, u.email), u.me ? el('span', { class: 'sub' }, 'you') : null),
            !u.me ? el('button', { class: 'sm', onclick: async () => { if (!confirm(`Take ${u.email} off? Their link stops working.`)) return; try { await del(`${base}/users/${encodeURIComponent(u.email)}`); render2(); } catch (e) { say(e.message); } } }, 'Remove') : el('span', {})))),
            el('div', { class: 'portal-add' }, el('input', { type: 'email', placeholder: 'Colleague\'s email', oninput: (e) => { nu.email = e.target.value; } }), el('input', { placeholder: 'Name', oninput: (e) => { nu.name = e.target.value; } }),
              el('button', { class: 'primary', onclick: async () => { try { await post(`${base}/users`, nu); say(`Added: ${nu.email} gets an email with their own link.`); render2(); } catch (e) { say(e.message); } } }, 'Add')))),
          el('p', { class: 'sub small', style: { marginTop: '24px' } }, `Questions? ${[c.company.email, c.company.phone].filter(Boolean).join(' · ')}`));
        if (want && !opened) { opened = true; const x = c.docs.find((d) => d.id === want); const n = document.getElementById('doc-' + want); if (n) n.scrollIntoView({ block: 'center' }); if (x && x.sign) signQuote(x, render2, c.terms); }
      }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    }
    render2();
    return box;
  }
  // ---- a release form (/release/<key>): permission to be filmed, signed on the phone; a parent or guardian signs for a child
  function releasePage(key) {
    const box = el('div', { class: 'portal release' }, el('div', { class: 'empty' }, 'Loading…'));
    const api0 = '/api/public/release/' + encodeURIComponent(key);
    get(api0).then((r) => {
      const F = r.form;
      document.title = `Release form – ${r.company.name}`;
      if (!F.open) { box.replaceChildren(el('div', { class: 'empty' }, `This release form is closed. Questions? ${r.company.email || ''}`)); return; }
      const f = { name: '', email: '', phone: '', minor: false, minorName: '', relation: 'Parent', raw: false, promo: false, agree: false };
      // the signature: drawn with a finger or mouse, or a picture of it
      const cv = el('canvas', { width: 520, height: 170, class: 'sign-pad' });
      const ctx = cv.getContext('2d');
      let drawn = false, down = false, mode = 'draw';
      const clear = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.strokeStyle = '#0b1b3a'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawn = false; };
      const at = (e) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height]; };
      cv.addEventListener('pointerdown', (e) => { if (mode !== 'draw') return; down = true; cv.setPointerCapture(e.pointerId); const [px, py] = at(e); ctx.beginPath(); ctx.moveTo(px, py); e.preventDefault(); });
      cv.addEventListener('pointermove', (e) => { if (!down) return; const [px, py] = at(e); ctx.lineTo(px, py); ctx.stroke(); drawn = true; e.preventDefault(); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => cv.addEventListener(k, () => { down = false; }));
      clear();
      const err = el('p', { class: 'err', style: { display: 'none' } });
      const fail = (t) => { err.textContent = t; err.style.display = ''; err.scrollIntoView({ block: 'center' }); };
      const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onchange: () => {
        const fl = file.files[0]; if (!fl) return;
        const im = new Image();
        im.onload = () => { clear(); const sc = Math.min((cv.width - 20) / im.width, (cv.height - 20) / im.height); const w = im.width * sc, hh = im.height * sc; ctx.drawImage(im, (cv.width - w) / 2, (cv.height - hh) / 2, w, hh); drawn = true; mode = 'upload'; tabs(); URL.revokeObjectURL(im.src); };
        im.onerror = () => fail('That picture could not be read.');
        im.src = URL.createObjectURL(fl); file.value = '';
      } });
      const tDraw = el('button', { type: 'button', class: 'sm', onclick: () => { mode = 'draw'; clear(); tabs(); } }, 'Draw');
      const tLoad = el('button', { type: 'button', class: 'sm', onclick: () => file.click() }, 'Load a picture');
      const tabs = () => { tDraw.className = 'sm' + (mode === 'draw' ? ' primary' : ''); tLoad.className = 'sm' + (mode === 'upload' ? ' primary' : ''); };
      tabs();
      const inp = (k, label, attrs = {}) => el('label', { class: 'fld' }, el('span', {}, label), el('input', { ...attrs, oninput: (e) => { f[k] = e.target.value; } }));
      const childBox = el('div', { style: { display: 'none' } }, inp('minorName', 'Name of the child'),
        el('label', { class: 'fld' }, el('span', {}, 'You are their'), el('select', { onchange: (e) => { f.relation = e.target.value; } }, ['Parent', 'Legal guardian'].map((x) => el('option', {}, x)))));
      const tick = (k, text, strong) => el('label', { class: 'tick' }, el('input', { type: 'checkbox', onchange: (e) => { f[k] = e.target.checked; } }), strong ? el('b', {}, text) : el('span', {}, text));
      const lines = String(F.text || '').split(/\n/);
      const btn = el('button', { class: 'primary big', onclick: async () => {
        err.style.display = 'none';
        if (f.name.trim().length < 2) return fail('Type your full name.');
        if (f.minor && f.minorName.trim().length < 2) return fail('Type the name of the child.');
        if (!f.agree) return fail('Tick that you give permission for the final production.');
        if (!drawn) return fail('Sign in the white box, or load a picture of your signature.');
        btn.disabled = true;
        try {
          const res = await post(api0, { ...f, method: mode, image: cv.toDataURL('image/png') });
          box.replaceChildren(el('div', { class: 'release-done' }, el('div', { class: 'big-tick' }, '✓'), el('h1', {}, 'Thank you!'),
            el('p', {}, `Your release for ${F.production || F.name} is signed. It allows: ${res.allows}.`),
            f.email ? el('p', { class: 'sub' }, `A signed copy is on its way to ${f.email}.`) : el('p', { class: 'sub' }, 'You can close this page.'),
            el('p', { class: 'sub small' }, `To withdraw it later, contact ${r.company.name}${r.company.email ? ' at ' + r.company.email : ''}.`)));
          window.scrollTo(0, 0);
        } catch (e) { fail(e.message); btn.disabled = false; }
      } }, 'Sign the release');
      box.replaceChildren(
        el('div', { class: 'thead' }, r.company.logo ? el('img', { class: 'tlogo big', src: img(r.company.logo), alt: '' }) : null,
          el('div', { class: 'grow' }, el('div', { class: 'sub' }, `Release form · ${r.company.name}`), el('h1', {}, F.production || F.name),
            el('div', { class: 'sub' }, [F.date, F.where].filter(Boolean).join(' · ')))),
        el('p', {}, 'Please give your permission to be filmed and photographed. It takes a minute and nothing needs printing.'),
        el('div', { class: 'terms-box', style: { maxHeight: 'none' } }, lines.map((l) => (/^\s*[-•*]\s+/.test(l) ? el('div', { class: 'bul' }, '• ' + l.replace(/^\s*[-•*]\s+/, '')) : l.trim() ? el('p', {}, l) : null))),
        section('You', el('div', { class: 'portal-details' }, inp('name', 'Your full name', { autocomplete: 'name' }), inp('email', 'Email (for your copy)', { type: 'email', autocomplete: 'email' }), inp('phone', 'Phone (optional)', { type: 'tel', autocomplete: 'tel' }))),
        F.minors ? el('div', {}, el('label', { class: 'tick' }, el('input', { type: 'checkbox', onchange: (e) => { f.minor = e.target.checked; childBox.style.display = f.minor ? '' : 'none'; } }), el('span', {}, 'I am signing for a child under 18')), childBox) : null,
        section('Your permission', el('div', { class: 'ticks' },
          tick('agree', 'I give permission to appear in the final production (required).', true),
          F.askRaw ? tick('raw', `Raw footage in which I (or the child) can be identified may also be kept and used, edited, licensed or sold by ${r.company.name} in other productions, stock footage and archives.`) : null,
          F.askPromo ? tick('promo', `Clips and photos may be used to promote ${r.company.name} (showreel, website, social media).`) : null)),
        section('Your signature', el('div', { class: 'fld' }, el('div', { class: 'row', style: { display: 'flex', gap: '6px', marginBottom: '6px' } }, tDraw, tLoad), cv, file,
          el('button', { type: 'button', class: 'sm', style: { marginTop: '6px' }, onclick: () => { mode = 'draw'; clear(); tabs(); } }, 'Clear'))),
        err, btn,
        el('p', { class: 'sub small', style: { marginTop: '18px' } }, `Your details are used only for this release, under POPIA. Questions? ${r.company.email || ''}`));
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
        t.rating ? ratingCard(t) : null,
        section('Messages', el('div', { class: 'chat' }, t.messages.length ? t.messages.map((m) => el('div', { class: 'msg ' + (m.from === 'client' ? 'me' : 'them') + (m.stage ? ' step' : '') },
          el('div', { class: 'sub' }, `${m.by} · ${when(m.at)}`), el('div', { class: 'body' }, m.text))) : el('p', { class: 'sub' }, 'No messages yet. We will write to you here, by email and on WhatsApp.'),
          el('div', { class: 'chat-send' }, ta, el('div', { class: 'row' }, sendBtn, err)))));
    };
    // after the event: stars, per aspect, a comment, and may we show it; then on to Google if they like
    function ratingCard(t) {
      const R = t.rating;
      const google = R.google ? el('a', { class: 'btn-big primary', href: R.google, target: '_blank', rel: 'noopener' }, 'Share it on Google too ↗') : null;
      if (R.done) return el('div', { class: 'rate-card', id: 'rate' }, el('h2', {}, 'Thank you for your rating!'), el('div', { class: 'stars big' }, '★'.repeat(R.done.stars) + '☆'.repeat(5 - R.done.stars)),
        R.done.comment ? el('p', { class: 'sub' }, '“' + R.done.comment + '”') : null,
        google ? [el('p', {}, 'It helps others find us: would you post it on Google as well? You can copy what you wrote here.'), google] : null);
      const v = { stars: 0, aspects: {}, comment: '', publicOk: true, shownAs: t.name };
      const starRow = (val, set, big) => { const row = el('div', { class: 'stars pick' + (big ? ' big' : '') }); const draw = () => row.replaceChildren(...[1, 2, 3, 4, 5].map((n) => el('button', { type: 'button', class: n <= val() ? 'on' : '', 'aria-label': n + ' stars', onclick: () => { set(n); draw(); } }, '★'))); draw(); return row; };
      const err = el('p', { class: 'err' });
      const btn = el('button', { class: 'primary' }, 'Send my rating');
      btn.onclick = async () => {
        if (!v.stars) { err.textContent = 'Tap the stars first'; return; }
        btn.disabled = true; err.textContent = '';
        try { paint(await post(`/api/public/track/${encodeURIComponent(key)}/rate`, v)); const c = document.getElementById('rate'); if (c) c.scrollIntoView({ behavior: 'smooth' }); } catch (e) { err.textContent = e.message; btn.disabled = false; }
      };
      return el('div', { class: 'rate-card', id: 'rate' }, el('h2', {}, 'How did we do?'), el('p', { class: 'sub' }, 'Your rating helps us get better. It takes half a minute.'),
        starRow(() => v.stars, (n) => { v.stars = n; }, true),
        el('div', { class: 'aspects' }, R.aspects.map((a) => el('div', { class: 'aspect' }, el('span', {}, a), starRow(() => v.aspects[a] || 0, (n) => { v.aspects[a] = n; })))),
        el('textarea', { rows: 3, placeholder: 'What went well, and what could we do better?', oninput: (e) => { v.comment = e.target.value; } }),
        el('label', { class: 'rate-ok' }, el('input', { type: 'checkbox', checked: '', onchange: (e) => { v.publicOk = e.target.checked; } }), ' You may show my review on your website as ',
          el('input', { value: v.shownAs, maxlength: 60, oninput: (e) => { v.shownAs = e.target.value; } })),
        el('div', { class: 'row' }, btn, err));
    }
    const load = () => get('/api/public/track/' + encodeURIComponent(key)).then((t) => { paint(t); if (new URLSearchParams(location.search).get('rate') && t.rating) setTimeout(() => { const c = document.getElementById('rate'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); });
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
    const sers = (D.series || []).filter((x) => match(q, x.title, x.channel.name)), pls = (D.playlists || []).filter((x) => match(q, x.title, x.channel.name));
    const heroLive = () => (first ? [el('h2', { class: 'sec' }, el('span', { style: { color: 'var(--live)' } }, '●'), 'Live now'),
      el('div', { class: 'hero' }, el('a', { href: '/watch/' + first.slug }, thumb(first, el('span', { class: 'badge live' }, '● LIVE'))),
        el('div', {}, el('a', { href: '/c/' + first.channel.slug, 'data-nav': '', style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' } }, avatar(first.channel.logo, first.channel.name, 'chlogo'), el('b', {}, first.channel.name)),
          el('h3', {}, first.title), el('div', { class: 'sub' }, `${first.viewers || 0} watching now`), el('p', {}, el('a', { href: '/watch/' + first.slug }, el('button', { class: 'primary' }, '▶ Watch')))))] : null);
    // the parts of the page (Content → Website can put them in another order, with rows of its own between)
    const B = {
      hero: heroLive,
      live: (t, rest) => section(t || 'Live now', (rest ? live.slice(1) : live).length ? el('div', { class: 'grid' }, (rest ? live.slice(1) : live).map((x) => streamCard(x))) : null),
      liveMatches: (t) => section(mLive.length ? t || 'Live matches' : '', mLive.length ? el('div', { class: 'matches' }, mLive.map(matchCard)) : null),
      upcoming: (t) => section(t || 'Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((x) => streamCard(x))) : null),
      videos: (t) => section(t || 'Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 24).map((x) => streamCard(x))) : null, vids.length > 24 ? el('a', { href: '/videos', 'data-nav': '' }, 'See all ' + vids.length) : ''),
      series: (t) => section(t || 'Series', sers.length ? el('div', { class: 'grid' }, sers.slice(0, 12).map(seriesCard)) : null),
      playlists: (t) => section(t || 'Playlists', pls.length ? el('div', { class: 'grid' }, pls.slice(0, 12).map(playlistCard)) : null),
      fixtures: (t) => section(t || 'Fixtures', mUp.length ? el('div', { class: 'matches' }, mUp.map(matchCard)) : null),
      results: (t) => section(t || 'Results', mRes.length ? el('div', { class: 'matches' }, mRes.map(matchCard)) : null),
      channels: (t) => section(t || 'Channels', chans.length ? el('div', { class: 'chans' }, chans.map(chanChip)) : null),
    };
    if (D.layout && !q) return laidOut(D.layout, { ...B, live: (t) => B.live(t, D.layout.heroMode === 'auto') });
    const out = [heroLive(), first && live.length > 1 ? el('div', { class: 'grid', style: { marginTop: '18px' } }, live.slice(1).map((x) => streamCard(x))) : null,
      B.liveMatches(), B.upcoming(), B.videos(), B.series(), B.playlists(), B.fixtures(), B.results(), B.channels()];
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
    vids.push(...(c.vods || []));
    const sers = c.series || [];
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
    const pls = c.playlists || [];
    const CB = {
      live: (tt) => section(tt || 'Live now', live.length ? el('div', { class: 'grid' }, live.map((x) => streamCard(x, { noChannel: true }))) : null),
      upcoming: (tt) => section(tt || 'Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((x) => streamCard(x, { noChannel: true }))) : null),
      videos: (tt) => section(tt || 'Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 12).map((x) => streamCard(x, { noChannel: true }))) : null),
      series: (tt) => section(tt || 'Series', sers.length ? el('div', { class: 'grid' }, sers.slice(0, 8).map(seriesCard)) : null),
      playlists: (tt) => section(tt || 'Playlists', pls.length ? el('div', { class: 'grid' }, pls.slice(0, 8).map(playlistCard)) : null),
    };
    const body = t === 'sermons' ? sermonsBox() : t === 'upcoming' ? (up.length ? [el('div', { class: 'up-list' }, up.map(upRow)), c.subscribed ? null : el('p', { class: 'sub' }, 'Subscribe to get an email when a stream starts.')] : el('div', { class: 'empty' }, 'Nothing scheduled yet.'))
      : t === 'about' ? el('div', { class: 'about' }, ch.description || 'No description yet.', el('p', {}, `${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${ch.owner === 'Production company' ? 'by ' + ch.company : ch.owner + ' channel · ' + ch.company}`))
      : t === 'series' ? (sers.length ? el('div', { class: 'grid' }, sers.map(seriesCard)) : el('div', { class: 'empty' }, 'No series yet.'))
      : t === 'playlists' ? (pls.length ? el('div', { class: 'grid' }, pls.map(playlistCard)) : el('div', { class: 'empty' }, 'No playlists yet.'))
      : t === 'videos' ? (vids.length ? el('div', { class: 'grid' }, vids.map((s) => streamCard(s, { noChannel: true }))) : el('div', { class: 'empty' }, 'No videos yet.'))
        : c.layout ? laidOut(c.layout, CB, { noChannel: true })
        : [section('Live now', live.length ? el('div', { class: 'grid' }, live.map((s) => streamCard(s, { noChannel: true }))) : null), section('Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((s) => streamCard(s, { noChannel: true }))) : null),
          section('Series', sers.length ? el('div', { class: 'grid' }, sers.slice(0, 8).map(seriesCard)) : null),
          section('Playlists', pls.length ? el('div', { class: 'grid' }, pls.slice(0, 8).map(playlistCard)) : null),
          section('Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 12).map((s) => streamCard(s, { noChannel: true }))) : null), !live.length && !up.length && !vids.length && !sers.length ? el('div', { class: 'empty' }, 'Nothing here yet.') : null];
    return [el('div', { class: 'banner', style: { backgroundImage: ch.banner ? `url("${img(ch.banner)}")` : `linear-gradient(120deg, ${ch.color}, #151515 75%)` } }),
      el('div', { class: 'chead' }, ch.logo ? el('img', { class: 'big', src: img(ch.logo), alt: '' }) : el('span', { class: 'big avatar', style: { fontSize: '44px' } }, ch.name.slice(0, 1)),
        el('div', { style: { flex: 1, minWidth: '200px' } }, el('h1', {}, ch.name), el('div', { class: 'sub' }, `/c/${ch.slug} · ${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${vids.length} video${vids.length === 1 ? '' : 's'}`)), sub),
      el('div', { class: 'tabs' }, tabLink('home', 'Home'), tabLink('upcoming', 'Upcoming' + (up.length ? ` (${up.length})` : '')), tabLink('videos', 'Videos'), sers.length ? tabLink('series', 'Series') : null, pls.length ? tabLink('playlists', 'Playlists') : null, ch.owner === 'Church' || /church|kerk|gemeente|ministr/i.test(ch.name + ' ' + (ch.company || '')) || t === 'sermons' ? tabLink('sermons', 'Sermons') : null, tabLink('about', 'About')), body];
  }

  // ---- videos on demand (/v/<video>) and series (/s/<series>): play, carry on where you stopped, next episode, buy
  const TK = 'rfp-tickets', POS = 'rfp-vod-pos';
  const myTickets = () => { try { return JSON.parse(localStorage.getItem(TK) || '[]').filter((t) => /^tk_/.test(t)); } catch (e) { return []; } };
  const keepTicket = (t) => { if (!/^tk_/.test(t || '')) return; try { localStorage.setItem(TK, JSON.stringify([t, ...myTickets().filter((x) => x !== t)].slice(0, 30))); } catch (e) { /* private window */ } };
  const positions = () => { try { return JSON.parse(localStorage.getItem(POS) || '{}'); } catch (e) { return {}; } };
  const savePos = (id, t, d) => { try { const p = positions(); p[id] = { t: Math.round(t), d: Math.round(d), at: Date.now() }; const keys = Object.keys(p); if (keys.length > 300) keys.sort((a, b) => p[a].at - p[b].at).slice(0, 50).forEach((k) => delete p[k]); localStorage.setItem(POS, JSON.stringify(p)); } catch (e) { /* private window */ } };
  const seenPart = (id) => { const x = positions()[id]; return x && x.d ? Math.min(1, x.t / x.d) : 0; };
  const vget = async (url, opts = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'x-rfp': '1', 'x-rfp-tickets': myTickets().join(','), ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  };
  const zar = (n) => 'R ' + Number(n).toFixed(2).replace(/\.00$/, '');
  // back from PayFast with ?paid=<id>: wait for the confirmation, keep the ticket in this browser, show the page again
  function afterPayment(onDone) {
    const id = new URLSearchParams(location.search).get('paid');
    if (!id) return null;
    const box = el('div', { class: 'push-inline' }, el('span', {}, '⏳ Waiting for PayFast to confirm your payment…'));
    let n = 0;
    const tick = async () => {
      let s = null;
      try { s = await get('/api/pay/status/' + encodeURIComponent(id)); } catch { s = null; }
      if (s && s.status === 'Paid') { keepTicket(s.ticket); history.replaceState(null, '', location.pathname); box.replaceChildren(el('span', {}, '✓ Paid – enjoy! Your ticket is also in your email.')); setTimeout(onDone, 800); return; }
      if (s && ['Failed', 'Cancelled'].includes(s.status)) { box.replaceChildren(el('span', {}, 'The payment did not go through. Nothing was charged; you can try again.')); return; }
      if (++n < 40) setTimeout(tick, 3000); else box.replaceChildren(el('span', {}, 'PayFast has not confirmed it yet. If you paid, your ticket arrives by email.'));
    };
    tick();
    return box;
  }
  // what to buy: this video, the whole series, or the channel pass
  function buyBox(options, info) {
    const name = el('input', { placeholder: 'Your name', autocomplete: 'name' });
    const email = el('input', { type: 'email', placeholder: 'Your email address (the ticket is sent there)', autocomplete: 'email' });
    const err = el('div', { class: 'err' });
    const go = async (kind, id, btn) => {
      btn.disabled = true; err.textContent = '';
      try { await payGo('/api/public/vod/buy', { kind, id, email: email.value, name: name.value }); } catch (e) { err.textContent = e.message; btn.disabled = false; }
    };
    if (!info.payments) return el('div', { class: 'vod-lock' }, el('h2', {}, 'This needs a ticket'), el('p', {}, 'Tickets are not on sale yet. Try again later.'));
    return el('div', { class: 'vod-lock' }, el('h2', {}, 'Watch with a ticket'),
      el('div', { class: 'vod-buy' }, options.map((o) => { const b = el('button', { class: 'primary', onclick: () => go(o.kind, o.id, b) }, o.label); return el('div', {}, b, el('div', { class: 'sub' }, o.sub)); })),
      D.me ? el('p', { class: 'sub' }, 'Signed in as ' + D.me.email + ': the ticket is kept on your account.') : el('div', { class: 'vod-who' }, name, email, el('p', { class: 'sub' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); signIn('Sign in to keep your tickets on your account.'); } }, 'Sign in'), ' to keep it on your account instead.')),
      err, el('p', { class: 'sub' }, 'Paid securely with PayFast (card, Instant EFT, SnapScan …).'));
  }
  function seasonsList(series, currentId) {
    if (!series || !series.seasons.length) return null;
    const anyPaid = series.seasons.some((x) => x.episodes.some((e) => !e.free));
    let open = (series.seasons.find((s) => s.episodes.some((e) => e.id === currentId)) || series.seasons[0]).number;
    const box = el('div', {});
    const paint = () => {
      const s = series.seasons.find((x) => x.number === open) || series.seasons[0];
      box.replaceChildren(series.seasons.length > 1 ? el('div', { class: 'tabs' }, series.seasons.map((x) => el('a', { href: '#', class: x.number === open ? 'on' : '', onclick: (e) => { e.preventDefault(); open = x.number; paint(); } }, x.title))) : el('h3', { class: 'vod-season' }, s.title),
        el('div', { class: 'eps' }, s.episodes.map((e) => el('a', { class: 'ep' + (e.id === currentId ? ' on' : ''), href: '/v/' + e.id, 'data-nav': '' },
          el('div', { class: 'thumb', style: { backgroundImage: e.poster ? `url("${img(e.poster)}")` : '' } }, e.duration ? el('span', { class: 'badge dur' }, dur(e.duration)) : null, seenPart(e.id) > 0.02 ? el('div', { class: 'seen' }, el('span', { style: { width: Math.round(seenPart(e.id) * 100) + '%' } })) : null),
          el('div', {}, el('b', {}, (e.episode ? e.episode + '. ' : '') + e.title, e.free && anyPaid ? el('span', { class: 'chip' }, 'Free') : null), e.description ? el('div', { class: 'sub' }, e.description.slice(0, 160)) : null)))));
    };
    paint();
    return box;
  }
  // ---- our player (the same as the live streams'): a stage and the bar under it, for files, YouTube and live HLS
  let curMedia = null;
  function stopMedia() { if (!curMedia) return; const m = curMedia; curMedia = null; try { if (m.destroy) m.destroy(); else { m.pause(); m.removeAttribute('src'); m.load(); } } catch (e) { /* gone */ } if (m._hls) m._hls.destroy(); }
  function playerBox() { const stage = el('div', { class: 'stage' }); const ctrl = el('div', {}); return { box: el('div', { class: 'player' }, stage, ctrl), stage, ctrl }; }
  const resumeAt = (id, d) => { const p = positions()[id]; return p && p.t > 10 && (!d || p.t < d - 15) ? p.t : 0; };
  // { youtube, start } | { src, poster } | { hls, token, poster }
  function mediaFor(stage, it) {
    stopMedia();
    let m;
    if (it.youtube) m = window.RFPMedia.youtube(stage, it.youtube, { start: it.start || 0 });
    else {
      m = el('video', { playsinline: '', preload: 'auto', poster: it.poster ? img(it.poster) : null });
      if (it.hls) m._hls = window.RFPMedia.hls(m, it.hls, it.token); else m.src = it.src;
      stage.append(m);
    }
    curMedia = m;
    return m;
  }
  function attach(pb, media, opts) {
    const unmute = el('button', { class: 'unmute', onclick: (e) => { e.stopPropagation(); media.muted = false; window.RFPPlayer.saveSound(media); media.play().catch(() => {}); unmute.remove(); } }, '🔊 Tap for sound');
    const b = window.RFPPlayer.mount(media, { player: pb.box, color: opts.color || '', live: !!opts.live, since: opts.since || 0, prev: opts.prev, next: opts.next, prevLabel: opts.prevLabel, nextLabel: opts.nextLabel, onList: opts.onList, listLabel: opts.listLabel, subtitles: opts.subtitles || [], onUnmute: () => unmute.remove() });
    pb.ctrl.replaceChildren(b.el); pb.box.classList.add('has-bar');
    setTimeout(() => window.RFPPlayer.playWithSound(media, () => pb.stage.append(unmute)), 30);
    return b;
  }
  // comments on a video (beside the player): read by anyone who may watch, written when signed in
  function vodComments(v) {
    const box = el('aside', { class: 'watch-side' }, el('h3', {}, 'Comments'), el('p', { class: 'sub small' }, 'Loading…'));
    const ago2 = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
    const url = '/api/public/v/' + encodeURIComponent(v.id) + '/comments';
    let form = null;
    async function load() {
      let r;
      try { r = await vget(url); } catch (e) { box.replaceChildren(el('h3', {}, 'Comments'), el('p', { class: 'sub small' }, e.message)); return; }
      const list = el('div', { class: 'clist' }, r.comments.length ? r.comments.slice().reverse().map((c) => el('div', { class: 'cm' },
        c.image ? el('img', { class: 'av', src: c.image, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'av' }, (c.name || '?').slice(0, 1).toUpperCase()),
        el('div', {}, el('b', {}, c.name), el('span', { class: 'when' }, ago2(c.at)),
          c.mine || r.canModerate ? el('button', { class: 'rm', title: 'Remove', onclick: async () => { await fetch('/api/comments/' + encodeURIComponent(c.id), { method: 'DELETE', credentials: 'same-origin', headers: { 'x-rfp': '1' } }); load(); } }, '✕') : null,
          el('div', { class: 't' }, c.text)))) : el('p', { class: 'sub small' }, 'No comments yet. Be the first.'));
      if (!form) {
        if (r.signedIn) {
          const input = el('textarea', { rows: 2, maxlength: 500, placeholder: 'Add a comment…' });
          const err = el('p', { class: 'err small' });
          const send = async () => {
            const text = input.value.trim(); if (!text) return;
            try { await vget(url, { method: 'POST', body: JSON.stringify({ text }) }); input.value = ''; err.textContent = ''; load(); } catch (e) { err.textContent = e.message; }
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
          form = el('div', { class: 'cform' }, input, el('button', { class: 'primary', onclick: send }, 'Send'), err);
        } else form = el('p', { class: 'sub small' }, el('a', { href: '/?signin=1&next=' + encodeURIComponent(location.pathname) }, 'Sign in'), ' to comment.');
      }
      box.replaceChildren(el('h3', {}, 'Comments' + (r.comments.length ? ` (${r.comments.length})` : '')), form, list);
    }
    load();
    return box;
  }
  async function videoPage(id, password) {
    let v;
    try { v = await vget('/api/public/v/' + encodeURIComponent(id), password !== undefined ? { method: 'POST', body: JSON.stringify({ password }) } : {}); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = v.title + ' · ' + v.channel.name;
    const paid = afterPayment(() => render());
    const head = [el('h1', { class: 'vod-title' }, v.title), el('div', { class: 'vod-meta' },
      el('a', { href: '/c/' + v.channel.slug, 'data-nav': '', class: 'row' }, avatar(v.channel.logo, v.channel.name, 'chlogo'), el('b', {}, v.channel.name)),
      v.series ? el('a', { href: '/s/' + v.series.id, 'data-nav': '', class: 'sub' }, v.series.title + (v.label ? ' · ' + v.label : '')) : null, v.duration ? el('span', { class: 'sub' }, dur(v.duration)) : null)];
    let stage;
    if (v.needs === 'processing') stage = el('div', { class: 'vod-lock' }, el('h2', {}, 'This video is being prepared'), el('p', {}, v.status === 'processing' ? `Almost there (${v.progress}%). Try again in a few minutes.` : 'It is not ready yet.'));
    else if (v.needs === 'password') {
      const pw = el('input', { type: 'password', placeholder: 'Password' });
      const go = async () => { const view = await videoPage(id, pw.value); $('main').replaceChildren(...[view].flat(Infinity).filter(Boolean), siteFooter()); };
      stage = el('div', { class: 'vod-lock' }, el('h2', {}, 'This channel needs a password'), el('div', { class: 'row' }, pw, el('button', { class: 'primary', onclick: go }, 'Watch')));
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    } else if (v.needs === 'signin') stage = el('div', { class: 'vod-lock' }, el('h2', {}, 'For the production team'), el('p', {}, 'Sign in with the account of a team member to watch this.'), signInButton());
    else if (v.needs === 'team') stage = el('div', { class: 'vod-lock' }, el('h2', {}, 'For the production team only'), el('p', {}, 'This channel is only for its production team.'));
    else if (v.needs === 'ticket') {
      const pr = v.price, opts = [];
      if (pr.video) opts.push({ kind: 'vod', id: v.id, label: `Buy this video · ${zar(pr.video)}`, sub: 'Watch it as often as you like.' });
      if (pr.series) opts.push({ kind: 'series', id: v.id, label: `Buy the series · ${zar(pr.series.amount)}`, sub: `Every episode of ${pr.series.title}.` });
      if (pr.pass) opts.push({ kind: 'pass', id: v.id, label: `Channel pass · ${zar(pr.pass.amount)}`, sub: `Everything paid on ${v.channel.name} for ${pr.pass.days} days, live streams too.` });
      stage = el('div', { class: 'vod-stage locked', style: { backgroundImage: v.poster ? `url("${img(v.poster)}")` : '' } }, buyBox(opts, v));
    } else {
      const pb = playerBox();
      const media = mediaFor(pb.stage, v.youtube ? { youtube: v.youtube, start: resumeAt(v.id, v.duration) } : { src: v.src, poster: v.poster });
      const over = el('div', { class: 'vod-next', style: { display: 'none' } });
      pb.stage.append(over);
      let lastSave = 0, counted = false, played = 0, timer = null;
      const go = (to) => { clearInterval(timer); history.pushState(null, '', '/v/' + to); window.scrollTo(0, 0); render(); };
      if (!v.youtube) media.addEventListener('loadedmetadata', () => { const at = resumeAt(v.id, media.duration); if (at) media.currentTime = at; }, { once: true });
      media.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - lastSave > 5000 && media.duration) { lastSave = now; savePos(v.id, media.currentTime, media.duration); }
        if (!media.paused) played += 0.25;
        if (!counted && played > 40) { counted = true; post('/api/public/v/' + encodeURIComponent(v.id) + '/view', {}).catch(() => {}); }
      });
      media.addEventListener('ended', () => {
        savePos(v.id, media.duration, media.duration);
        if (!v.next) return;
        let n = 6;
        const cancel = el('button', { onclick: () => { clearInterval(timer); over.style.display = 'none'; } }, 'Cancel');
        const now1 = el('button', { class: 'primary', onclick: () => go(v.next.id) }, 'Play now');
        const txt = el('b', {});
        over.replaceChildren(el('div', { class: 'sub' }, 'Next episode'), el('div', { class: 'vod-next-title' }, v.next.title), txt, el('div', { class: 'row' }, now1, cancel));
        over.style.display = '';
        const step = () => { txt.textContent = `Starts in ${n}…`; if (n-- <= 0) go(v.next.id); };
        step(); timer = setInterval(step, 1000);
      });
      const flat = v.series ? v.series.seasons.flatMap((x) => x.episodes) : [];
      const at = flat.findIndex((e) => e.id === v.id);
      attach(pb, media, { subtitles: v.subtitles, color: v.channel.color, prev: at > 0 ? () => go(flat[at - 1].id) : null, next: v.next ? () => go(v.next.id) : null, prevLabel: 'Previous episode', nextLabel: 'Next episode',
        onList: v.series ? () => { const t = document.querySelector('.eps'); if (t) t.scrollIntoView({ behavior: 'smooth' }); } : null, listLabel: 'Episodes' });
      stage = pb.box;
    }
    // the player sized to fit the screen, comments on the right, everything else underneath
    return [paid, el('div', { class: 'watch' },
      el('div', { class: 'watch-main' }, stage, head,
        v.description ? el('div', { class: 'desc-box', style: { whiteSpace: 'pre-wrap' } }, v.description) : null,
        v.next && !v.needs ? el('p', {}, el('a', { href: '/v/' + v.next.id, 'data-nav': '' }, el('button', {}, 'Next: ' + v.next.title + ' ›'))) : null,
        v.series ? [el('h2', { class: 'sec' }, v.series.title), seasonsList(v.series, v.id)] : null),
      v.needs && v.needs !== 'processing' ? null : vodComments(v))];
  }
  async function seriesPage(id) {
    let s;
    try { s = await vget('/api/public/s/' + encodeURIComponent(id)); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = s.title + ' · ' + s.channel.name;
    const paid = afterPayment(() => render());
    const flat = s.seasons.flatMap((x) => x.episodes);
    const resume = flat.find((e) => seenPart(e.id) > 0.02 && seenPart(e.id) < 0.95) || flat.find((e) => seenPart(e.id) < 0.95) || flat[0];
    const started = flat.some((e) => seenPart(e.id) > 0.02);
    const buys = [];
    if (s.price && !s.owned) {
      buys.push({ kind: 'series', id: s.id, label: `Buy the series · ${zar(s.price.series)}`, sub: `All ${flat.length} episode${flat.length === 1 ? '' : 's'}, as often as you like.` });
      if (s.price.pass) buys.push({ kind: 'pass', id: s.id, label: `Channel pass · ${zar(s.price.pass.amount)}`, sub: `Everything paid on ${s.channel.name} for ${s.price.pass.days} days.` });
    }
    return [paid, el('div', { class: 'banner vod-banner', style: { backgroundImage: s.banner || s.poster ? `url("${img(s.banner || s.poster)}")` : `linear-gradient(120deg, ${s.channel.color}, #151515 75%)` } }),
      el('div', { class: 'vod-shead' + (s.poster ? ' has-poster' : '') }, s.poster ? el('img', { class: 'vod-poster', src: img(s.poster), alt: '' }) : null,
        el('div', { style: { flex: 1, minWidth: '220px' } }, el('h1', { class: 'vod-title' }, s.title),
          el('div', { class: 'vod-meta' }, el('a', { href: '/c/' + s.channel.slug, 'data-nav': '', class: 'row' }, avatar(s.channel.logo, s.channel.name, 'chlogo'), el('b', {}, s.channel.name)),
            el('span', { class: 'sub' }, [s.seasons.length > 1 ? s.seasons.length + ' seasons' : '', flat.length + ' episode' + (flat.length === 1 ? '' : 's'), s.price ? (s.owned ? 'Yours ✓' : zar(s.price.series)) : 'Free'].filter(Boolean).join(' · '))),
          s.description ? el('p', { style: { whiteSpace: 'pre-wrap' } }, s.description) : null,
          resume ? el('a', { href: '/v/' + resume.id, 'data-nav': '' }, el('button', { class: 'primary' }, (started ? '▶ Carry on: ' : '▶ Play: ') + (resume.episode ? 'E' + resume.episode + ' ' : '') + resume.title)) : null)),
      buys.length ? buyBox(buys, s) : null,
      flat.length ? seasonsList(s, '') : el('div', { class: 'empty' }, 'No episodes yet.')];
  }
  const seriesCard = (s) => el('a', { class: 'card', href: s.href, 'data-nav': '' }, thumb(s, [el('span', { class: 'badge dur' }, `${s.episodes} ep`), s.price ? el('span', { class: 'badge price' }, zar(s.price.ticket)) : null]),
    el('div', { class: 'meta' }, avatar(s.channel.logo, s.channel.name, 'chlogo'), el('div', {}, el('b', {}, s.title), el('div', { class: 'sub' }, s.channel.name, el('br'), s.seasons > 1 ? s.seasons + ' seasons' : 'Series'))));

  // ---- a playlist (/p/<id>): uploaded and YouTube videos, and live streams (live while on air, then the recording)
  async function playlistPage(id) {
    let pl;
    try { pl = await vget('/api/public/p/' + encodeURIComponent(id)); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = pl.title + ' · ' + pl.channel.name;
    if (!pl.items.length) return el('div', { class: 'empty' }, 'This playlist is empty.');
    const params = new URLSearchParams(location.search);
    let i = Math.min(pl.items.length - 1, Math.max(0, Number(params.get('i')) || 0));
    const pb = playerBox();
    const title = el('h1', { class: 'vod-title' }), sub = el('div', { class: 'vod-meta' });
    const list = el('div', { class: 'pl-list' });
    let skipT = null;
    const paintList = () => list.replaceChildren(el('div', { class: 'pl-head' }, el('b', {}, pl.title), el('span', { class: 'sub' }, `${i + 1} / ${pl.items.length}`)),
      pl.items.map((it, n) => el('a', { href: '#', class: 'pl-item' + (n === i ? ' on' : ''), onclick: (e) => { e.preventDefault(); play(n); } },
        el('span', { class: 'pl-n' }, n === i ? '▶' : String(n + 1)),
        el('div', { class: 'thumb', style: { backgroundImage: it.poster ? `url("${img(it.poster)}")` : '' } }, it.live ? el('span', { class: 'badge live' }, '● LIVE') : it.duration ? el('span', { class: 'badge dur' }, dur(it.duration)) : null, it.kind === 'vod' && seenPart(it.id) > 0.02 ? el('div', { class: 'seen' }, el('span', { style: { width: Math.round(seenPart(it.id) * 100) + '%' } })) : null),
        el('div', {}, el('b', {}, it.title), el('div', { class: 'sub' }, it.kind === 'live' ? (it.live ? 'Live now' : it.recordings ? 'Recording' : it.date ? 'Live · ' + day(it.date, it.time) : 'Live stream') : [it.of, it.youtube ? 'YouTube' : '', it.price ? zar(it.price.ticket) : ''].filter(Boolean).join(' · '))))));
    // a card over the picture instead of playing (a ticket, a password, not on yet …), moving on by itself
    const notice = (head, text, link, linkLabel, autoSkip) => {
      stopMedia();
      const left = el('b', {});
      const next = i < pl.items.length - 1;
      pb.stage.replaceChildren(el('div', { class: 'slate' }, el('b', {}, head), el('p', {}, text), el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
        link ? el('a', { href: link }, el('button', { class: 'primary' }, linkLabel)) : null, next ? el('button', { onclick: () => play(i + 1) }, 'Skip ›') : null), next && autoSkip ? el('p', { class: 'small' }, left) : null));
      if (next && autoSkip) { let n = autoSkip; const step = () => { left.textContent = `Next in ${n}…`; if (n-- <= 0) { clearInterval(skipT); play(i + 1); } }; step(); skipT = setInterval(step, 1000); }
      pb.ctrl.replaceChildren(); pb.box.classList.remove('has-bar');
    };
    const nav = { prev: () => (i > 0 ? play(i - 1) : null), next: () => (i < pl.items.length - 1 ? play(i + 1) : null) };
    const onEnd = () => { if (i < pl.items.length - 1) play(i + 1); };
    async function play(n) {
      clearInterval(skipT);
      i = n;
      history.replaceState(null, '', location.pathname + (i ? '?i=' + i : ''));
      const it = pl.items[i];
      title.textContent = it.title;
      sub.replaceChildren(el('a', { href: '/c/' + pl.channel.slug, 'data-nav': '', class: 'row' }, avatar(pl.channel.logo, pl.channel.name, 'chlogo'), el('b', {}, pl.channel.name)),
        el('a', { href: it.kind === 'live' ? '/watch/' + it.slug : '/v/' + it.id, class: 'sub' }, it.kind === 'live' ? 'Open the stream page ›' : 'Open the video page ›'));
      paintList();
      pb.stage.replaceChildren();
      const common = { color: pl.channel.color, prev: i > 0 ? nav.prev : null, next: i < pl.items.length - 1 ? nav.next : null, prevLabel: 'Previous in playlist', nextLabel: 'Next in playlist', onList: () => list.scrollIntoView({ behavior: 'smooth' }), listLabel: 'Playlist' };
      if (it.kind === 'vod') {
        let v;
        try { v = await vget('/api/public/v/' + encodeURIComponent(it.id)); } catch (e) { return notice('This video is not available', e.message, '', '', 6); }
        if (v.needs === 'ticket') return notice('This one needs a ticket', `${v.title} is paid content.`, '/v/' + v.id, 'Get a ticket', 10);
        if (v.needs === 'password') return notice('This needs a password', 'Open it to type the channel\'s password.', '/v/' + v.id, 'Open', 10);
        if (v.needs) return notice('Not available here', v.needs === 'processing' ? 'It is still being prepared.' : 'It is only for the production team.', '', '', 6);
        const m = mediaFor(pb.stage, v.youtube ? { youtube: v.youtube, start: resumeAt(v.id, v.duration) } : { src: v.src, poster: v.poster });
        if (!v.youtube) m.addEventListener('loadedmetadata', () => { const at = resumeAt(v.id, m.duration); if (at) m.currentTime = at; }, { once: true });
        let last = 0;
        m.addEventListener('timeupdate', () => { if (Date.now() - last > 5000 && m.duration) { last = Date.now(); savePos(v.id, m.currentTime, m.duration); } });
        m.addEventListener('ended', () => { savePos(v.id, m.duration, m.duration); onEnd(); });
        m.addEventListener('error', () => { if (m.error && typeof m.error === 'string') notice('This video cannot play', m.error, '', '', 6); });
        attach(pb, m, { ...common, subtitles: v.subtitles });
        return;
      }
      // a live stream: on air → live; over → its newest recording; not yet → when it starts
      let w;
      try { w = await vget('/api/watch/' + encodeURIComponent(it.slug)); } catch (e) { return notice('This stream is not available', e.message, '', '', 6); }
      if (w.needs) return notice(w.needs === 'ticket' ? 'This stream needs a ticket' : 'Not available here', w.title, '/watch/' + it.slug, 'Open the stream page', 10);
      if (w.live && w.hls) {
        const m = mediaFor(pb.stage, { hls: w.hls, token: w.token, poster: w.poster });
        if (!m._hls) return notice('This browser cannot play the stream here', '', '/watch/' + it.slug, 'Open the stream page', 0);
        attach(pb, m, { ...common, live: true, since: w.since || 0 });
        return;
      }
      const rec = (w.videos || [])[0];
      if (rec) { const m = mediaFor(pb.stage, { src: rec.url, poster: w.poster }); m.addEventListener('ended', onEnd); attach(pb, m, common); return; }
      if (w.startsAt && Date.parse(w.startsAt) > Date.now()) return notice('Coming up', `${w.title} starts ${day(w.date, w.time)}.`, '/watch/' + it.slug, 'Open the stream page', 8);
      return notice('Not live right now', w.title, '/watch/' + it.slug, 'Open the stream page', 6);
    }
    setTimeout(() => play(i), 0);
    return [el('div', { class: 'pl-wrap' }, el('div', { class: 'pl-main' }, pb.box, title, sub, pl.description ? el('div', { class: 'desc-box', style: { whiteSpace: 'pre-wrap' } }, pl.description) : null), list)];
  }
  const playlistCard = (p) => el('a', { class: 'card', href: p.href, 'data-nav': '' }, thumb(p, [p.live ? el('span', { class: 'badge live' }, '● LIVE') : null, el('span', { class: 'badge dur' }, `▤ ${p.count}`)]),
    el('div', { class: 'meta' }, avatar(p.channel.logo, p.channel.name, 'chlogo'), el('div', {}, el('b', {}, p.title), el('div', { class: 'sub' }, p.channel.name, el('br'), 'Playlist'))));
  // any card of a row: a series, a playlist, or a video / stream
  const anyCard = (x, opts) => (x.episodes !== undefined ? seriesCard(x) : x.count !== undefined && /^\/p\//.test(x.href || '') ? playlistCard(x) : streamCard(x, opts));
  // a page arranged in Content → Website: the featured item, then the rows in their order (built-in rows drawn by the page)
  function laidOut(L, builtin, opts = {}) {
    const out = [];
    if (L.heroMode === 'pick' && L.hero) {
      const x = L.hero;
      out.push(el('div', { class: 'hero' }, el('a', { href: x.href, 'data-nav': /^\/(v|s|p)\//.test(x.href) ? '' : null }, thumb(x, x.live ? el('span', { class: 'badge live' }, '● LIVE') : null)),
        el('div', {}, el('a', { href: '/c/' + x.channel.slug, 'data-nav': '', style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' } }, avatar(x.channel.logo, x.channel.name, 'chlogo'), el('b', {}, x.channel.name)),
          el('h3', {}, x.title), x.of ? el('div', { class: 'sub' }, x.of) : x.episodes ? el('div', { class: 'sub' }, `${x.episodes} episodes`) : null,
          el('p', {}, el('a', { href: x.href, 'data-nav': /^\/(v|s|p)\//.test(x.href) ? '' : null }, el('button', { class: 'primary' }, x.live ? '● Watch live' : '▶ Watch'))))));
    } else if (L.heroMode === 'auto' && builtin.hero) out.push(builtin.hero());
    for (const r of L.rows) {
      if (r.type === 'builtin') { const b = builtin[r.key]; if (b) out.push(b(r.title)); continue; }
      out.push(section(r.title, el('div', { class: 'grid' }, r.cards.map((x) => anyCard(x, opts))), r.href ? el('a', { href: r.href, 'data-nav': '' }, 'See all') : ''));
    }
    return out;
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
      l.reviews && (l.reviews.list.length || l.reviews.google) ? [el('h2', { class: 'sec' }, 'What clients say', l.reviews.count ? el('span', { class: 'count' }, `${'★'.repeat(Math.round(l.reviews.average))} ${l.reviews.average} from ${l.reviews.count} rating${l.reviews.count === 1 ? '' : 's'}`) : null),
        l.reviews.list.length ? el('div', { class: 'reviews' }, l.reviews.list.map((r) => el('div', { class: 'review' }, el('div', { class: 'stars' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)), el('p', {}, '“' + r.comment + '”'),
          el('div', { class: 'sub' }, [r.by, r.organisation, r.service].filter(Boolean).join(' · '))))) : null,
        l.reviews.google ? el('p', {}, el('a', { class: 'btn-big', href: l.reviews.google, target: '_blank', rel: 'noopener' }, 'Review us on Google ↗')) : null] : null,
      l.email || l.phone ? el('p', { class: 'land-contact' }, 'Contact us: ', l.email ? el('a', { href: 'mailto:' + l.email }, l.email) : null, l.email && l.phone ? ' · ' : '', l.phone ? el('a', { href: 'tel:' + l.phone.replace(/\s+/g, '') }, l.phone) : null) : null];
  }
  // ---- the booking form (/book), as the site admin set it up (Settings → Website → Booking form; shared/bookingform.js):
  // the standard fields, "What kind of event?", and sections of questions that show for certain services or kinds
  async function bookPage(service) {
    let l;
    try { l = await landingData(); } catch (e) { return el('div', { class: 'empty' }, e.message); }
    document.title = 'Book services · ' + (l.site || 'RegemarkFP');
    const F = l.bookingForm, C = F.core;
    const label = (k, fallback) => (C[k] && C[k].label) || fallback;
    const on = (k) => !C[k] || C[k].on;
    const star = (k) => (C[k] && C[k].req ? ' *' : '');
    const f = { name: D.me ? D.me.name : '', email: D.me ? D.me.email : '', phone: '', organisation: '', service, date: '', endDate: '', startTime: '', endTime: '', venue: '', town: '', details: '', website: '', contactBy: (C.contactBy && C.contactBy.opts[0]) || '', budget: '', heard: '' };
    const A = {};                  // answers to the section questions: { question: answer }
    let kind = '';
    const input = (k, fallback, attrs = {}) => (on(k) ? el('label', { class: 'fld' }, el('span', {}, label(k, fallback) + star(k)), el('input', { ...attrs, required: C[k] && C[k].req ? '' : null, value: f[k] || '', oninput: (e) => { f[k] = e.target.value; } })) : null);
    const pick = (k, fallback, opts) => (on(k) ? el('label', { class: 'fld' }, el('span', {}, label(k, fallback) + star(k)), el('select', { required: C[k] && C[k].req ? '' : null, onchange: (e) => { f[k] = e.target.value; } }, opts.map((o) => el('option', { value: o === 'Choose…' ? '' : o, selected: f[k] === o ? '' : null }, o)))) : null);
    const question = (x) => {
      const cls = 'fld' + (x.wide || x.type === 'many' || x.type === 'long' ? ' wide' : ''), name = x.label + (x.req ? ' *' : '');
      if (x.type === 'one') return el('label', { class: cls }, el('span', {}, name), el('select', { required: x.req ? '' : null, onchange: (e) => { A[x.label] = e.target.value; } }, ['Choose…', ...x.opts].map((o) => el('option', { value: o === 'Choose…' ? '' : o, selected: A[x.label] === o ? '' : null }, o))));
      if (x.type === 'many') return el('div', { class: cls }, el('span', {}, name), el('div', { class: 'chips' }, x.opts.map((o) => {
        const has = () => String(A[x.label] || '').split(', ').filter(Boolean).includes(o);
        const b = el('button', { type: 'button', class: 'chip' + (has() ? ' on' : ''), onclick: () => { const cur = String(A[x.label] || '').split(', ').filter(Boolean); A[x.label] = (has() ? cur.filter((y) => y !== o) : [...cur, o]).join(', '); b.classList.toggle('on', has()); } }, o);
        return b;
      })));
      if (x.type === 'long') return el('label', { class: cls }, el('span', {}, name), el('textarea', { rows: 3, placeholder: x.ph || '', required: x.req ? '' : null, oninput: (e) => { A[x.label] = e.target.value; } }, A[x.label] || ''));
      return el('label', { class: cls }, el('span', {}, name), el('input', { type: x.type === 'number' ? 'number' : x.type === 'date' ? 'date' : 'text', min: x.type === 'number' ? 0 : null, placeholder: x.ph || '', required: x.req ? '' : null, value: A[x.label] || '', oninput: (e) => { A[x.label] = e.target.value; } }));
    };
    const head = (t, sub) => el('div', { class: 'wide book-sec' }, el('h2', {}, t), sub ? el('p', { class: 'sub' }, sub) : null);
    const err = el('p', { class: 'err' });
    const box = el('div', { class: 'book' });
    const btn = el('button', { class: 'primary', type: 'submit' }, 'Send request');
    const extra = el('div', { class: 'wide book-extra' });
    const visible = () => F.groups.filter((g) => BF.shown(g, f.service, kind));
    const paintExtra = () => {
      if (!BF.asksKind(F, f.service)) kind = '';
      extra.replaceChildren(el('div', { class: 'book-form inner' },
        BF.asksKind(F, f.service) ? el('label', { class: 'fld wide' }, el('span', {}, F.kinds.label), el('select', { onchange: (e) => { kind = e.target.value; paintExtra(); } }, ['Choose…', ...F.kinds.list].map((o) => el('option', { value: o === 'Choose…' ? '' : o, selected: kind === o ? '' : null }, o)))) : null,
        visible().map((g) => [head(g.title, g.sub), g.questions.map(question)])));
    };
    const opts = (l.services || []).map((x) => x.title);
    const sel = el('select', { required: '', onchange: (e) => { f.service = e.target.value; paintExtra(); } }, el('option', { value: '' }, 'Choose…'), opts.map((o) => el('option', { value: o, selected: o === service ? '' : null }, o)), el('option', { value: 'Something else' }, 'Something else'));
    const form = el('form', { class: 'book-form', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      // only the answers of sections that show now (a section hidden after switching service is left out)
      const keep = new Set(visible().flatMap((g) => g.questions.map((x) => x.label)));
      const answers = [...(kind ? [{ q: F.kinds.label, a: kind }] : []), ...Object.entries(A).filter(([k2, v]) => keep.has(k2) && String(v || '').trim()).map(([k2, a]) => ({ q: k2, a: String(a) }))];
      const missing = visible().flatMap((g) => g.questions).find((x) => x.req && x.type === 'many' && !String(A[x.label] || '').trim());
      if (missing) { err.textContent = `Please answer "${missing.label}"`; btn.disabled = false; return; }
      const ta = form.querySelector('textarea.details');
      try { const r = await post('/api/public/booking', { ...f, details: ta ? ta.value : '', answers });
        box.replaceChildren(el('h1', {}, 'Thank you'), el('p', { class: 'sub' }, 'We have your request and will be in touch soon.' + (f.email ? ' A copy is on its way to ' + f.email + ', with the link to follow your booking.' : '')),
          r && r.track ? el('p', {}, el('a', { class: 'btn-big', href: r.track, 'data-nav': '' }, 'Follow your booking ›'), ' ', el('span', { class: 'sub' }, 'Keep this link: it shows where your booking stands, and you can send us a message there.')) : null,
          el('a', { class: 'btn-big', href: '/', 'data-nav': '' }, 'Back to the home page'));
        window.scrollTo(0, 0);
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    } },
      head('You'),
      el('label', { class: 'fld' }, el('span', {}, 'Your name *'), el('input', { required: '', autocomplete: 'name', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
      input('organisation', 'Organisation', { autocomplete: 'organization' }), input('email', 'Email', { type: 'email', autocomplete: 'email' }), on('phone') ? el('label', { class: 'fld' }, el('span', {}, label('phone', 'Phone') + star('phone')), Phone.input(f.phone, (v) => { f.phone = v; }, { make: el, dial: l.dial, required: C.phone && C.phone.req })) : null,
      pick('contactBy', 'Best way to reach you', C.contactBy ? C.contactBy.opts : []),
      head('The event'),
      el('label', { class: 'fld' }, el('span', {}, 'Service *'), sel), input('date', 'Date', { type: 'date' }),
      input('startTime', 'Starts at', { type: 'time' }), input('endTime', 'Ends at', { type: 'time' }), input('endDate', 'Last day', { type: 'date' }),
      input('venue', 'Venue', { placeholder: 'e.g. Grey College, B-field' }), input('town', 'Town / city', { placeholder: 'e.g. Bloemfontein' }),
      extra,
      on('budget') || on('heard') || on('details') ? head('Anything else') : null,
      pick('budget', 'Budget', ['Choose…', ...((C.budget && C.budget.opts) || [])]), pick('heard', 'How did you hear about us?', ['Choose…', ...((C.heard && C.heard.opts) || [])]),
      on('details') ? el('label', { class: 'fld wide' }, el('span', {}, label('details', 'Tell us more') + star('details')), el('textarea', { class: 'details', rows: 4, required: C.details && C.details.req ? '' : null, placeholder: 'Anything we should know: the programme, special requests, links …' })) : null,
      el('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', oninput: (e) => { f.website = e.target.value; } }),
      err, el('div', { class: 'wide' }, btn));
    paintExtra();
    box.append(el('h1', {}, 'Book services'), F.intro ? el('p', { class: 'sub' }, F.intro) : null, form);
    return box;
  }
  // the section rules, as in shared/bookingform.js (the website sends the form already cleaned)
  const BF = {
    shown: (g, service, kind) => !!service && (!(g.when || []).length || g.when.includes(service) || (!!kind && g.when.includes(kind))),
    asksKind: (form, service) => !!(service && form.kinds.on && form.kinds.list.length && !form.kinds.skip.includes(service))
  };

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
    if (window.RFPNative && window.RFPNative.signInWithGoogle) {
      // the Android app: the phone's own Google account sheet, else the browser round trip
      const nx = backTo ? new URL(backTo, location.href).pathname : location.pathname;
      const btn = el('button', { class: 'primary', onclick: () => {
        if (!window.RFPNative.googleSignIn) { window.RFPNative.signInWithGoogle(nx); return; }
        btn.disabled = true; btn.textContent = 'Signing in…';
        window.rfpGoogleToken = async (token, why) => {
          if (token) {
            try {
              await post('/api/auth/google', { credential: token });
              D = await get('/api/public/home');
              if (backTo) { location.href = backTo; return; }
              if (D.me && D.me.teams) { location.href = '/app'; return; }
              close(); render(); return;
            } catch (e) { err.textContent = e.message; err.style.display = ''; }
          } else if (why && why !== 'cancelled') { window.RFPNative.signInWithGoogle(nx); }
          btn.disabled = false; btn.textContent = 'Sign in with Google';
        };
        window.RFPNative.googleSignIn(D.googleClientId);
      } }, 'Sign in with Google');
      holder.replaceChildren(btn);
      return;
    }
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
    const I = { '⌂': 'home', '▦': 'apps', '✉': 'mail', '◎': 'trophy', '⚑': 'shield', '⬇': 'download', '♥': 'heart', '▶': 'library', '★': 'subs', '◉': 'tv', '⚙': 'login' };
    const ico = (g) => el('span', { class: 'nav-ico' }, window.RFPIcons ? window.RFPIcons.svg(I[g] || 'chevron', 22) : g);
    const link = (href, label, icon) => el('a', { href, 'data-nav': '', class: p === href ? 'on' : '' }, ico(icon), label);
    const subs = D && D.me ? D.channels.filter((c) => (D.me.subscriptions || []).includes(c.id)) : [];
    $('side').replaceChildren(link('/', 'Home', '⌂'), link('/browse', 'Browse', '▦'), link('/book', 'Book services', '✉'), link('/matches', 'Matches', '◎'), link('/teams', 'Teams', '⚑'), link('/software', 'Software', '⬇'), D && D.me ? link('/following', 'Following' + ((D.me.follows || []).length ? ` (${D.me.follows.length})` : ''), '♥') : null, link('/videos', 'Videos', '▶'), link('/subscriptions', 'Subscriptions', '★'), link('/channels', 'Channels', '◉'),
      subs.length ? [el('hr'), el('h4', {}, 'Subscriptions'), subs.map((c) => el('a', { href: '/c/' + c.slug, 'data-nav': '', class: p === '/c/' + c.slug ? 'on' : '' }, c.logo ? el('img', { class: 'chip-logo', src: img(c.logo), alt: '' }) : el('span', { class: 'chip-logo' }), c.name))] : null,
      D && D.me && D.me.teams ? [el('hr'), el('a', { href: '/app', class: 'studio-link' }, ico('⚙'), 'Studio (your production team)')] : null,
      D && !D.me ? [el('hr'), el('a', { href: '#', class: 'studio-link', onclick: (e) => { e.preventDefault(); signIn('Production team members: sign in to open your Studio.'); } }, ico('⚙'), 'Production teams: sign in')] : null);
  }
  function meBox() {
    const m = D && D.me;
    let menu = null;
    const toggle = (e) => { e.stopPropagation(); if (menu) { menu.remove(); menu = null; return; }
      menu = el('div', { class: 'me-menu' }, el('div', { class: 'who' }, el('b', {}, m.name || ''), el('div', { class: 'sub' }, m.email)),
        m.teams ? el('a', { href: '/app' }, 'Studio') : null, el('a', { href: '/subscriptions', 'data-nav': '' }, 'Subscriptions'), el('a', { href: '/notifications', 'data-nav': '' }, 'Notifications'), el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); signOut(); } }, 'Sign out'));
      // client portals of this email (a client of a production company): one link each
      const box = menu;
      get('/api/public/my-portals').then((r) => { if (box.isConnected && r.portals.length) box.insertBefore(el('div', { class: 'me-portals' }, el('div', { class: 'sub small' }, r.portals.length > 1 ? 'Client portals' : 'Client portal'), r.portals.map((x) => el('a', { href: x.url }, x.client))), box.children[1] || null); }).catch(() => {});
      $('me').append(menu); document.addEventListener('click', () => { if (menu) { menu.remove(); menu = null; } }, { once: true }); };
    $('me').replaceChildren(m && m.teams ? el('a', { href: '/app' }, el('button', { class: 'studio' }, 'Studio')) : null,
      m ? el('button', { class: 'icon avatar-btn', title: m.email, onclick: toggle }, avatar(m.image, m.name || m.email)) : signInButton());
  }
  // ---- legal: /legal (company information), /terms, /privacy, and the footer on every page
  let legalP = null;
  const legalInfo = () => legalP || (legalP = get('/api/public/legal').catch((e) => { legalP = null; throw e; }));
  function legalText(text) {
    return el('div', { class: 'legal-text' }, String(text || '').split(/\n/).map((raw) => {
      const l = raw.trim();
      if (!l) return null;
      if (/^\d+\.\s+\S/.test(l) && l.length < 80 && !/^\d+\.\d/.test(l)) return el('h3', {}, l);
      if (/^[-•*]\s+/.test(l)) return el('div', { class: 'bul' }, '• ' + l.replace(/^[-•*]\s+/, ''));
      return el('p', {}, l);
    }));
  }
  function legalPage(kind) {
    const box = el('div', { class: 'legal' }, el('div', { class: 'empty' }, 'Loading…'));
    legalInfo().then((L) => {
      const tabs = el('div', { class: 'legal-tabs' }, [['/legal', 'Company information'], ['/terms', 'Terms and conditions'], ['/privacy', 'Privacy policy (POPIA)']].map(([href, label]) => el('a', { href, 'data-nav': '', class: location.pathname === href ? 'on' : '' }, label)));
      const rows = [['Registered name', L.company], L.tradingAs && ['Trading as', L.tradingAs], L.regNo && ['Registration number', L.regNo], L.vatNo && ['VAT number', L.vatNo], L.directors && ['Directors', L.directors],
        L.address && ['Physical address (also for legal notices)', L.address], L.email && ['Email', L.email], L.phone && ['Phone', L.phone], ['Website', location.origin], L.infoOfficer && ['Information officer (POPIA)', L.infoOfficer]].filter(Boolean);
      const body = kind === 'terms' ? (L.terms ? legalText(L.terms) : el('p', { class: 'sub' }, 'The terms and conditions are given with every quote.'))
        : kind === 'privacy' ? legalText(L.privacy)
        : [el('table', { class: 'legal-info' }, rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', { style: { whiteSpace: 'pre-line' } }, v)))),
          el('h3', {}, 'Prices, payment and cancellations'),
          el('p', {}, 'Prices are quoted per booking and include VAT where VAT applies. A quote is accepted by signing it in the client portal. Payments are made by EFT or through PayFast; we do not see or keep card details. Cancellations and refunds are set out in clause 4 of the terms and conditions.'),
          el('h3', {}, 'Complaints'),
          el('p', { style: { whiteSpace: 'pre-line' } }, L.complaints || `Contact us first at ${L.email || 'our email address'}; we answer within 5 business days. If we cannot resolve it, you may contact the Consumer Goods and Services Ombud (cgso.org.za) or the National Consumer Commission (thencc.gov.za). For personal information: the Information Regulator (inforegulator.org.za).`)];
      document.title = { terms: 'Terms and conditions', privacy: 'Privacy policy' }[kind] || 'Company information';
      box.replaceChildren(el('h1', {}, document.title), tabs, body);
    }).catch((e) => box.replaceChildren(el('div', { class: 'empty' }, e.message)));
    return box;
  }
  function siteFooter() {
    const year = new Date().getFullYear();
    const line = el('span', {}, `© ${year} ${D.site || ''}. All rights reserved.`);
    legalInfo().then((L) => { line.textContent = `© ${L.year} ${L.company}. All rights reserved.`; }).catch(() => {});
    return el('footer', { class: 'site-foot' }, line, el('nav', {}, el('a', { href: '/terms', 'data-nav': '' }, 'Terms'), el('a', { href: '/privacy', 'data-nav': '' }, 'Privacy'), el('a', { href: '/legal', 'data-nav': '' }, 'Company information')));
  }
  async function render() {
    stopMedia();
    side(); meBox();
    const p = location.pathname, params = new URLSearchParams(location.search);
    document.body.classList.toggle('landing', p === '/' || p === '');
    document.title = D.site || 'RegemarkFP';
    let view;
    if (centre && !p.startsWith('/match/')) { centre.stop(); centre = null; }
    if (p.startsWith('/client/')) view = clientPage(decodeURIComponent(p.slice(8).replace(/\/$/, '')));
    else if (p.startsWith('/portal/')) view = portalPage(decodeURIComponent(p.slice(8).replace(/\/$/, '')));
    else if (p.startsWith('/release/')) view = releasePage(decodeURIComponent(p.slice(9).replace(/\/$/, '')));
    else if (p.startsWith('/track/')) view = trackPage(decodeURIComponent(p.slice(7).replace(/\/$/, '')));
    else if (p.startsWith('/player/')) view = playerPage(decodeURIComponent(p.slice(8).replace(/\/$/, '')));
    else if (p === '/software') view = softwarePage();
    else if (p.startsWith('/software/')) view = appPage(decodeURIComponent(p.slice(10).replace(/\/$/, '')));
    else if (p === '/teams') view = teamsPage();
    else if (p.startsWith('/team/')) view = teamPage(decodeURIComponent(p.slice(6).replace(/\/$/, '')));
    else if (p === '/following') view = followingPage();
    else if (p.startsWith('/match/')) view = matchPage(decodeURIComponent(p.slice(7).replace(/\/$/, '')));
    else if (/^\/v\/[\w-]+\/?$/.test(p)) view = await videoPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')));
    else if (/^\/p\/[\w-]+\/?$/.test(p)) view = await playlistPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')));
    else if (/^\/s\/[\w-]+\/?$/.test(p)) view = await seriesPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')));
    else if (p.startsWith('/c/')) view = await channelPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')), params.get('tab'));
    else if (p === '/videos') view = videosPage();
    else if (p === '/matches') view = matchesPage();
    else if (p === '/channels') view = channelsPage();
    else if (p === '/subscriptions') view = subscriptionsPage();
    else if (p === '/notifications') view = notificationsPage();
    else if (p === '/book') view = await bookPage(params.get('service') || '');
    else if (p === '/legal' || p === '/terms' || p === '/privacy') view = legalPage(p.slice(1));
    else if (p === '/' || p === '') view = await landingPage();
    else view = home();
    $('main').replaceChildren(...[view].flat(Infinity).filter(Boolean), siteFooter());
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
    setTimeout(offerApp, 1500);
  }
  // an Admin on an Android phone's browser (not in the app): offer the app once, again after 14 days if they said Not now
  function offerApp() {
    const ua = navigator.userAgent;
    if (!D || !D.me || !D.me.appOk || !D.androidApp || !/Android/i.test(ua) || !/Mobile/i.test(ua) || /; wv\)|RFPManager/.test(ua) || document.getElementById('app-offer')) return;
    try { if (Date.now() - Number(localStorage.getItem('rfp-app-offer') || 0) < 14 * 86400e3) return; } catch (e) { /* ask */ }
    const later = () => { try { localStorage.setItem('rfp-app-offer', String(Date.now())); } catch (e) { /* asked again next time */ } };
    const close = () => { later(); wrap.remove(); };
    const wrap = el('div', { id: 'app-offer', class: 'modal', onclick: (e) => { if (e.target === wrap) close(); } },
      el('div', { class: 'modal-box' }, el('button', { class: 'icon x', onclick: close, 'aria-label': 'Close' }, '✕'),
        el('img', { src: '/brand/rfp-logo-sm.png', alt: '', style: { height: '34px' } }), el('h2', {}, 'Get the RFP Manager app'),
        el('p', { class: 'sub' }, 'Run your productions from the Android app: push notifications for bookings, crew and matches, and Google sign-in that stays signed in.'),
        el('p', {}, el('a', { class: 'btn-big primary', href: '/app/rfp-manager.apk', download: 'rfp-manager.apk', onclick: () => { later(); setTimeout(() => wrap.remove(), 300); } }, '⬇ Download the app')),
        el('p', { class: 'sub small' }, 'After downloading, open the file and allow installing from your browser if Android asks.'),
        el('button', { onclick: close }, 'Not now')));
    document.body.append(wrap);
  }
  load();
  setInterval(async () => { try { D = await get('/api/public/home'); if (!/^\/(c|match|team|software|client|player|track|v|s|p|portal|release)\//.test(location.pathname) && !['/', '/book', '/teams', '/following', '/notifications', '/software'].includes(location.pathname)) render(); } catch (e) { /* next time */ } }, 30000);   // live now / viewers
})();
