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
    return el('div', { class: 'match' },
      el('div', { class: 'top-line' }, el('span', {}, m.competition ? m.competition.name : m.sport), live ? el('span', { class: 'status-live' }, '● LIVE' + (m.period ? ' · ' + m.period : '')) : el('span', {}, m.status === 'Completed' ? 'Full time' : day(m.date, m.time))),
      team(m.teams[0] || { name: 'Home' }), team(m.teams[1] || { name: 'Away' }),
      m.score ? el('div', { class: 'score' }, m.score) : null,
      el('div', { class: 'foot' }, [m.venue, m.company].filter(Boolean).join(' · ')),
      m.watch ? el('a', { class: 'watch-btn' + (m.watch.live ? ' live' : ''), href: m.watch.href }, m.watch.live ? '● Watch live' : '▶ Watch the match') : null);
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
    const body = t === 'upcoming' ? (up.length ? [el('div', { class: 'up-list' }, up.map(upRow)), c.subscribed ? null : el('p', { class: 'sub' }, 'Subscribe to get an email when a stream starts.')] : el('div', { class: 'empty' }, 'Nothing scheduled yet.'))
      : t === 'about' ? el('div', { class: 'about' }, ch.description || 'No description yet.', el('p', {}, `${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${ch.owner === 'Production company' ? 'by ' + ch.company : ch.owner + ' channel · ' + ch.company}`))
      : t === 'videos' ? (vids.length ? el('div', { class: 'grid' }, vids.map((s) => streamCard(s, { noChannel: true }))) : el('div', { class: 'empty' }, 'No videos yet.'))
        : [section('Live now', live.length ? el('div', { class: 'grid' }, live.map((s) => streamCard(s, { noChannel: true }))) : null), section('Coming up', up.length ? el('div', { class: 'grid' }, up.slice(0, 8).map((s) => streamCard(s, { noChannel: true }))) : null),
          section('Videos', vids.length ? el('div', { class: 'grid' }, vids.slice(0, 12).map((s) => streamCard(s, { noChannel: true }))) : null), !live.length && !up.length && !vids.length ? el('div', { class: 'empty' }, 'Nothing here yet.') : null];
    return [el('div', { class: 'banner', style: { backgroundImage: ch.banner ? `url("${img(ch.banner)}")` : `linear-gradient(120deg, ${ch.color}, #151515 75%)` } }),
      el('div', { class: 'chead' }, ch.logo ? el('img', { class: 'big', src: img(ch.logo), alt: '' }) : el('span', { class: 'big avatar', style: { fontSize: '44px' } }, ch.name.slice(0, 1)),
        el('div', { style: { flex: 1, minWidth: '200px' } }, el('h1', {}, ch.name), el('div', { class: 'sub' }, `/c/${ch.slug} · ${c.subscribers} subscriber${c.subscribers === 1 ? '' : 's'} · ${vids.length} video${vids.length === 1 ? '' : 's'}`)), sub),
      el('div', { class: 'tabs' }, tabLink('home', 'Home'), tabLink('upcoming', 'Upcoming' + (up.length ? ` (${up.length})` : '')), tabLink('videos', 'Videos'), tabLink('about', 'About')), body];
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
      try { if (form.querySelector('textarea')) f.details = form.querySelector('textarea').value; await post('/api/public/booking', f);
        box.replaceChildren(el('h1', {}, 'Thank you'), el('p', { class: 'sub' }, 'We have your request and will be in touch soon.' + (f.email ? ' A copy is on its way to ' + f.email + '.' : '')), el('a', { class: 'btn-big', href: '/', 'data-nav': '' }, 'Back to the home page'));
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    } },
      input('name', 'Your name *', { required: '', autocomplete: 'name' }), input('organisation', 'Organisation / club / church', { autocomplete: 'organization' }),
      input('email', 'Email', { type: 'email', autocomplete: 'email' }), input('phone', 'Phone', { type: 'tel', autocomplete: 'tel' }),
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
  async function get(url) { const r = await fetch(url, { credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }
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
    $('side').replaceChildren(link('/', 'Home', '⌂'), link('/browse', 'Browse', '▦'), link('/book', 'Book services', '✉'), link('/matches', 'Matches', '◎'), link('/videos', 'Videos', '▶'), link('/subscriptions', 'Subscriptions', '★'), link('/channels', 'Channels', '◉'),
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
    if (p.startsWith('/c/')) view = await channelPage(decodeURIComponent(p.slice(3).replace(/\/$/, '')), params.get('tab'));
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
  $('search').addEventListener('submit', (e) => { e.preventDefault(); query = e.target.querySelector('input').value.trim().toLowerCase(); if (!['/browse', '/videos', '/matches', '/channels'].includes(location.pathname)) history.pushState(null, '', '/browse'); render(); });
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
  setInterval(async () => { try { D = await get('/api/public/home'); if (!location.pathname.startsWith('/c/') && !['/', '/book'].includes(location.pathname)) render(); } catch (e) { /* next time */ } }, 30000);   // live now / viewers
})();
