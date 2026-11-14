/* Help for every screen, in plain words (1.4.0): a "?" button on every Studio page (and the live screens) opens a panel
 * with what this page is for and how to do the usual things on it, a search over all the help, and "Getting started".
 * The same short descriptions are the menu's hover hints and the empty pages' explanations.
 *   RFPHelp.topic(hash) → { t, d, s[] } · RFPHelp.hint(href) → one line · RFPHelp.open(hash) · RFPHelp.mount(opts) */
'use strict';
(() => {
  // t: the page, d: what it is for (one line), s: how to do the usual things
  const T = {
    '#/': { t: 'Dashboard', d: 'Your day at a glance: what is live, today\'s matches and productions, and what is coming up.', s: ['Click a match or production to open it.', 'Score opens the scoring screen for a match; Graphics control opens the on-air graphics.', 'Use the menu on the left (or More on a phone) for everything else.'] },
    '#/notifications': { t: 'Notifications', d: 'Everything the app told you: new bookings, crew booked, streams going live, files sent to you.', s: ['Click one to go to it.', 'Choose what you get in Settings → My account → Notifications.'] },
    '#/list/booking': { t: 'Booking requests', d: 'Requests that clients sent with the booking form on the website.', s: ['Open a request to read it, reply, or turn it into a quote or a production.', 'Give it to someone in the team with "Allocated to".'] },
    '#/list/client': { t: 'Clients', d: 'The people and companies you work for, with their contact details and their own client portal.', s: ['+ New client to add one.', 'Open a client to see their quotes, invoices and productions, and to send them their portal link.'] },
    '#/money': { t: 'Quotes & invoices', d: 'Every quote and invoice: what was sent, what is owed, and what is paid.', s: ['+ New quote or + New invoice; add lines from your products and services.', 'Send emails it as a PDF with a link to pay or accept.', 'Tick several to send, mark as paid or download them in one go.'] },
    '#/list/service': { t: 'Products & services', d: 'What you sell and the price: the lines you put on quotes and invoices (also the services clients can book).', s: ['+ New to add one, with its price and unit (per hour, per day …).'] },
    '#/ratings': { t: 'Ratings', d: 'How clients rated your productions, and the reviews you can show on the website.', s: [] },
    '#/list/production': { t: 'Productions', d: 'Every job you do: a match, a church service, a wedding, a conference … with its date, crew, kit, costing and stream.', s: ['+ New production to add one.', 'Open it to book crew, add equipment, send the call sheet, make a quote and open its shared folder.', 'Tick several to change a field or archive them together.'] },
    '#/calendar': { t: 'Calendar', d: 'All productions and matches by day, week or month.', s: ['Click a day to add a production on it.', 'Click a production to open it.'] },
    '#/list/crewMember': { t: 'Crew', d: 'The people who work on your productions, with their roles, rates and contact details.', s: ['+ New crew member to add someone.', 'Book them on a production in the production\'s Crew section.'] },
    '#/list/crewRole': { t: 'Crew roles', d: 'The jobs on a production (camera operator, director, sound …) and what each one is paid.', s: [] },
    '#/list/equipment': { t: 'Equipment', d: 'Your kit: cameras, lenses, audio, cables … with how many you have and when it needs a service.', s: ['Add it to a production so you know what goes along.'] },
    '#/list/releaseForm': { t: 'Release forms', d: 'Forms people sign on their phone to agree to be filmed (with a parent for children).', s: ['+ New release form, then share its link or QR code at the event.'] },
    '#/list/expense': { t: 'Expenses', d: 'Money spent on a production (fuel, food, gear hire) to be approved and paid back.', s: ['+ New expense, add the slip, and choose the production.'] },
    '#/availability': { t: 'My availability', d: 'Tell the team which days you can (or cannot) work.', s: ['Click days to mark them.'] },
    '#/sharing': { t: 'File sharing', d: 'Shared folders on the server for productions: invite people to send or collect photos and video.', s: ['+ New folder, or press Shared folder on a production.', 'Invite people by email; they can look and download, or also add files.', 'Open File Sharing for the upload page.'] },
    '#/fixtures': { t: 'Fixtures & Results', d: 'All matches: coming up, live and finished.', s: ['+ New match to add one.', 'Score opens the scoring screen; the result is saved when the match is finished.', 'Search and filter by sport, competition or venue; Select to change many at once.'] },
    '#/list/competition': { t: 'Competitions', d: 'Leagues, cups and tournaments, with their logo and points system (the log fills in by itself).', s: [] },
    '#/list/club': { t: 'Clubs', d: 'Schools and clubs, with their logo, colours and short names for graphics.', s: ['A club has teams (Teams), and teams have players.'] },
    '#/list/squad': { t: 'Teams', d: 'The teams of a club (1st XV, U19A …) with their players and shirt numbers.', s: [] },
    '#/list/player': { t: 'Players', d: 'Every player, with photo and details; their statistics come from the scored matches.', s: ['Tick players and use "Add to team".'] },
    '#/list/venue': { t: 'Venues', d: 'Stadiums, halls and churches where productions happen.', s: [] },
    '#/pcs': { t: 'Production PCs', d: 'The computers that run graphics and playout at the venue, and whether they are online.', s: ['Choose which PC this browser works with at the top of the menu.'] },
    '#/monitors': { t: 'Monitors', d: 'Screens for the crew: commentary, rundown, clocks and stats, on any device.', s: ['Open one and put it on a TV, tablet or phone.'] },
    '#/templates': { t: 'Templates', d: 'The graphics templates on the production PC (CasparCG) and what each one shows.', s: [] },
    '#/list/theme': { t: 'Themes', d: 'The look of the graphics (colours, fonts, logos) per sport or client.', s: [] },
    '#/adverts': { t: 'Advert playout', d: 'Play adverts on air during a show, from a playlist or one by one.', s: [] },
    '#/list/dashboard': { t: 'Dashboards', d: 'Your own control screens: buttons, faders and live values you design yourself.', s: ['+ New dashboard, then Design to drag controls onto it.'] },
    '#/list/timeline': { t: 'Timelines', d: 'A show laid out on tracks (shots, graphics, lyrics, audio) and run with GO.', s: [] },
    '#/automation': { t: 'Variables & triggers', d: 'Values you can use in graphics, and rules that take graphics on and off by themselves (at a goal, at a time …).', s: [] },
    '#/variables': { t: 'Variables by sport', d: 'Every live value of every sport (score, clock, statistics, players) to link to graphics.', s: ['Search, then Copy to paste it into a template.'] },
    '#/list/channel': { t: 'Channels', d: 'Your channels on the website, where streams and videos are shown.', s: [] },
    '#/content': { t: 'Content', d: 'Everything viewers can watch: live streams, videos (VOD), playlists, and how the website shows them.', s: ['Upload a video or add YouTube links; put them in series or playlists.', 'Website lets you choose what is on the front page.'] },
    '#/streams': { t: 'Live streams', d: 'The live streams of your productions: stream keys, tickets and who is watching.', s: [] },
    '#/vod': { t: 'VOD', d: 'Videos people can watch any time: upload them or bring them in from YouTube.', s: [] },
    '#/playlists': { t: 'Playlists', d: 'Videos and streams that play one after the other.', s: [] },
    '#/youtube': { t: 'YouTube Live', d: 'Schedule live streams on your YouTube channel straight from here.', s: [] },
    '#/analytics': { t: 'Analytics', d: 'Who watched what, for how long, and from where.', s: [] },
    '#/sales': { t: 'Ticket sales', d: 'Tickets and passes sold for streams and videos.', s: [] },
    '#/streamads': { t: 'Stream adverts', d: 'Adverts shown to viewers on the website\'s streams.', s: [] },
    '#/list/advert': { t: 'Adverts', d: 'The adverts of your sponsors: pictures and videos for the screen and the stream.', s: [] },
    '#/list/adSlot': { t: 'Ad spaces', d: 'Places you sell to advertisers (a corner of the score bug, a break …) and their price.', s: [] },
    '#/list/playlist': { t: 'Ad playlists', d: 'Adverts in the order they play.', s: [] },
    '#/playlog': { t: 'Play log', d: 'Proof of what advert played, when, and for how long.', s: [] },
    '#/sponsors': { t: 'Sponsor reports', d: 'A report per sponsor of how often their adverts were shown.', s: [] },
    '#/images': { t: 'Images', d: 'Logos, photos and sponsor boards used by graphics and the website.', s: ['Upload images; tick several to delete them.'] },
    '#/list/track': { t: 'Music library', d: 'Music you may use, with who owns it and whether it is cleared.', s: [] },
    '#/music': { t: 'Music playout', d: 'Play music in breaks from the production PC.', s: [] },
    '#/musicrights': { t: 'Music use report', d: 'What music was used where, for licences.', s: [] },
    '#/list/service#worship': { t: 'Services', d: 'Church services with their running order of songs and readings.', s: [] },
    '#/list/song': { t: 'Songs', d: 'Song lyrics for the screens, imported from SongSelect or typed.', s: [] },
    '#/bibles': { t: 'Bibles', d: 'Bible translations for scripture on screen.', s: [] },
    '#/ccli': { t: 'CCLI report', d: 'Which songs were shown, for your CCLI licence report.', s: [] },
    '#/settings': { t: 'Settings', d: 'Your account, your production team, the website and this PC.', s: ['My account: your name, password and notifications.', 'Team: members and their roles, logo and colours.'] },
    '#/callsheet': { t: 'Call sheet', d: 'The crew\'s plan for the day: who, where and when.', s: ['Send it to the crew by email; they get it as a PDF too.'] },
    '#/rundown': { t: 'Rundown', d: 'The running order of the show, item by item, with times.', s: [] },
    '#/score': { t: 'Scoring', d: 'Score the match live: the graphics, the website and the apps follow.', s: [] },
  };
  // general questions, in the search too
  const FAQ = [
    { t: 'Getting started', d: 'Add your team members (Settings → Members), your crew and kit, then make a production. Open it to book crew, send the call sheet and make a quote.' },
    { t: 'Who can do what?', d: 'Admin: everything. Producer: everything but members and settings. Scorer: score matches and run graphics. Crew: see their productions and call sheets.' },
    { t: 'Something looks wrong', d: 'Reload the page. Still wrong? Settings → My account has "Send me a test email"; or ask an Admin of your team.' },
    { t: 'Select many at once', d: 'Most lists have tick boxes: tick, then change a field, archive, export or delete them together.' },
  ];
  const hintOf = (href) => (T[href] ? T[href].d : '');
  function topic(hash) {
    hash = String(hash || location.hash || '#/').replace(/\?.*$/, '');
    const m = /^#\/edit\/([\w]+)\//.exec(hash);
    if (m) { const base = T['#/list/' + m[1]]; return base ? { ...base, t: base.t + ': editing', s: ['Fill in the fields and press Save. Fields with * are needed.', ...(base.s || [])] } : null; }
    const keys = Object.keys(T).sort((a, b) => b.length - a.length);
    if (T[hash]) return T[hash];
    const k = keys.find((x) => x !== '#/' && hash.startsWith(x + '/'));
    return k ? T[k] : hash === '#/' || hash === '' ? T['#/'] : null;
  }
  // the panel
  const css = `
.rh-btn { position: fixed; right: 18px; bottom: 18px; z-index: 60; width: 46px; height: 40px; border: 0; cursor: pointer; font: 800 19px system-ui, sans-serif; color: #062b17; background: #00ff82; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); box-shadow: 0 6px 20px rgba(0,0,0,.4); padding: 0; }
.rh-btn:hover { filter: brightness(1.1); }
body.has-tabbar .rh-btn { bottom: 84px; }
.rh-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 90; background: #1b1b1b; color: #f1f1f1; overflow: auto; padding: 20px 22px 40px; box-shadow: -10px 0 40px rgba(0,0,0,.6); font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.rh-panel h2 { margin: 0; font-size: 21px; } .rh-panel h3 { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: #a8a8a8; margin: 22px 0 8px; }
.rh-panel p { margin: 6px 0; } .rh-panel .rh-d { color: #ddd; }
.rh-panel ol { margin: 6px 0; padding-left: 22px; } .rh-panel li { margin: 5px 0; }
.rh-panel input { width: 100%; box-sizing: border-box; font: inherit; color: #f1f1f1; background: #111; border: 1px solid #333; padding: 9px 12px; }
.rh-panel .rh-x { float: right; border: 0; background: #2a2a2a; color: #f1f1f1; padding: 6px 12px; cursor: pointer; font: inherit; }
.rh-panel .rh-hit { display: block; padding: 8px 0; border-top: 1px solid #2a2a2a; color: inherit; text-decoration: none; } .rh-panel a.rh-hit:hover b { color: #00ff82; }
.rh-panel .rh-hit span { display: block; color: #a8a8a8; font-size: 13px; }
@media print { .rh-btn { display: none; } }`;
  let panel = null;
  function open(hash, extra) {
    close();
    if (!document.getElementById('rh-css')) { const st = document.createElement('style'); st.id = 'rh-css'; st.textContent = css; document.head.append(st); }
    const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); return e; };
    const t = (extra && extra.topic) || topic(hash);
    const results = el('div', {});
    const all = [...Object.entries(T).filter(([k]) => !k.includes('#worship')).map(([href, x]) => ({ ...x, href })), ...FAQ, ...((extra && extra.more) || [])];
    const search = (q) => {
      q = q.trim().toLowerCase();
      results.replaceChildren(...(q ? all.filter((x) => (x.t + ' ' + x.d + ' ' + (x.s || []).join(' ')).toLowerCase().includes(q)).slice(0, 12) : FAQ).map((x) => (x.href && !extra
        ? el('a', { class: 'rh-hit', href: x.href, onclick: () => close() }, el('b', {}, x.t), el('span', {}, x.d))
        : el('div', { class: 'rh-hit' }, el('b', {}, x.t), el('span', {}, x.d)))));
      if (q && !results.childNodes.length) results.append(el('p', { style: 'color:#a8a8a8' }, 'Nothing found. Try another word.'));
    };
    panel = el('div', { class: 'rh-panel', role: 'dialog', 'aria-label': 'Help' },
      el('button', { class: 'rh-x', onclick: () => close() }, '✕ Close'),
      el('h3', { style: 'margin-top:0' }, 'This page'),
      t ? [el('h2', {}, t.t), el('p', { class: 'rh-d' }, t.d), t.s && t.s.length ? el('ol', {}, t.s.map((x) => el('li', {}, x))) : null]
        : el('p', { class: 'rh-d' }, 'Use the menu to get around. Search below for anything.'),
      extra && extra.keys ? [el('h3', {}, 'Keyboard'), el('div', {}, extra.keys.map(([k, v]) => el('div', { class: 'rh-hit' }, el('b', {}, k), el('span', {}, v))))] : null,
      el('h3', {}, 'Search the help'), el('input', { type: 'search', placeholder: 'e.g. invoice, crew, stream, score', oninput: (e) => search(e.target.value) }), results);
    document.body.append(panel);
    search('');
    setTimeout(() => document.addEventListener('keydown', esc), 0);
  }
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function close() { if (panel) { panel.remove(); panel = null; } document.removeEventListener('keydown', esc); }
  // the ? button (Studio pages: the topic follows the page; live screens pass their own topic and keys)
  function mount(extra) {
    if (document.querySelector('.rh-btn')) return;
    if (!document.getElementById('rh-css')) { const st = document.createElement('style'); st.id = 'rh-css'; st.textContent = css; document.head.append(st); }
    const b = document.createElement('button');
    b.className = 'rh-btn no-print'; b.textContent = '?'; b.title = 'Help: what this page is for and how to use it (?)'; b.setAttribute('aria-label', 'Help');
    b.onclick = () => (panel ? close() : open(location.hash, extra));
    document.body.append(b);
    document.addEventListener('keydown', (e) => { if (e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable)) { e.preventDefault(); b.click(); } });
    addEventListener('hashchange', () => { if (panel && !extra) open(location.hash); });
  }
  window.RFPHelp = { topic, hint: hintOf, open, close, mount, T, FAQ };
  // the live screens: <script src="/js/help.js" data-help='{"topic":…,"keys":…}'> mounts the ? with that page's help
  const me = document.currentScript;
  if (me && me.dataset.help) { try { const x = JSON.parse(me.dataset.help); const go = () => mount(x); if (document.body) go(); else addEventListener('DOMContentLoaded', go); } catch (e) { /* no help */ } }
})();
