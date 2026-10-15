/* Live streaming: a production's stream (what to type into OBS / vMix, live or not, recordings), a channel's look and
 * page, and the website's "Server" settings tab that makes the one-line command to set up a streaming server. */
'use strict';
(() => {
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast('Copied')).catch(() => toast('Select it and copy by hand', 'error'));
  const field = (label, value, secret) => {
    const shown = h('code', { style: { wordBreak: 'break-all', flex: 1 } }, secret ? '•'.repeat(Math.min(28, value.length)) : value);
    let open = !secret;
    return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line)' } },
      h('span', { class: 'dim small', style: { width: '120px', flex: 'none' } }, label), shown,
      secret ? h('button', { class: 'sm ghost', onclick: (e) => { open = !open; shown.textContent = open ? value : '•'.repeat(Math.min(28, value.length)); e.target.textContent = open ? 'Hide' : 'Show'; } }, 'Show') : null,
      h('button', { class: 'sm', onclick: () => copy(value) }, 'Copy'));
  };
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; };

  App.panels = App.panels || {};
  const liveTag = (on) => h('span', { class: 'pill', style: on ? { background: '#ff3b3b', color: '#fff' } : {} }, on ? 'LIVE' : 'Offline');

  // ---- a production's live stream: what to type into OBS / vMix, live or not, its videos
  function streamCard(doc) {
    const box = h('div', { class: 'card' }, h('div', { class: 'dim' }, 'Loading…'));
    let timer = null;
    const paint = async () => {
      if (!box.isConnected && timer) { clearInterval(timer); return; }
      const cur = App.docs.get(doc.id) || doc;
      if (!cur.data.streamChannel || !cur.data.streamSlug) { box.replaceChildren(h('h2', {}, 'Live stream'), h('p', { class: 'dim', style: { margin: 0 } }, 'Pick a channel under "Live stream on channel" below and save: this production gets its own stream key and watch page.')); return; }
      let r;
      try { r = await api('GET', '/api/streams?team=' + App.team); } catch (e) { box.replaceChildren(h('p', { class: 'dim' }, e.message)); return; }
      const s = r.list.find((x) => x.id === doc.id) || {};
      const watch = (r.base || location.origin) + '/watch/' + cur.data.streamSlug;
      const ch = App.docs.get(cur.data.streamChannel);
      const ing = s.ingest;
      box.replaceChildren(
        h('div', { class: 'spread' },
          h('div', {}, h('h2', { style: { margin: 0 } }, 'Live stream ', liveTag(s.live)),
            h('div', { class: 'dim small' }, [ch ? 'On ' + ch.data.name : '', s.live ? `live for ${ago(s.since)} · ${s.viewers} watching${s.kbps ? ` · ${(s.kbps / 1000).toFixed(1)} Mb/s in` : ''}${s.tracks && s.tracks.length ? ' · ' + s.tracks.join(', ') : ''}` : r.enabled ? 'nothing coming in right now' : '', s.videos ? `${s.videos} recording${s.videos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => copy(watch) }, 'Copy watch link'), h('a', { class: 'btn sm primary', href: watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'))),
        !r.enabled ? h('p', { class: 'dim', style: { marginBottom: 0 } }, 'This website has no streaming server yet. ', App.machine && App.machine.siteAdmin ? h('a', { href: '#/settings', onclick: () => { App.settingsTab = 'server'; } }, 'Set one up (Settings → Server)') : 'Ask whoever runs this website to set one up.', ' The stream key is kept and works as soon as the server is there.')
          : r.health && r.health.lastError ? h('p', { class: 'pill warn' }, 'The streaming server is not answering: ' + r.health.lastError) : null,
        ing ? [
          h('h3', { style: { marginTop: '16px' } }, 'OBS, vMix, Wirecast … over RTMP'),
          field('Server', ing.rtmpServer), field('Stream key', ing.rtmpKey, true),
          h('h3', { style: { marginTop: '16px' } }, 'SRT (vMix, OBS, encoders, Larix on a phone)'),
          field('Host', ing.srtHost), field('Port', String(ing.srtPort)), field('Stream ID', ing.srtStreamId, true), field('Full SRT URL', ing.srtUrl, true),
          h('p', { class: 'dim small' }, 'vMix: Settings → Outputs/NDI/SRT (or Streaming → SRT), type Caller, then the host, port and stream ID above. OBS: Settings → Stream → Custom, paste the full SRT URL as the server and leave the key empty. SRT copes better with poor internet than RTMP. Video H.264, audio AAC; 2–6 Mb/s, keyframe every 2 seconds.'),
          App.canEdit('production') ? h('button', { class: 'sm danger', onclick: async () => {
            if (!(await confirmBox('Make a new stream key? Anything still using the old key stops streaming until you paste the new one.'))) return;
            try { await api('POST', `/api/productions/${encodeURIComponent(doc.id)}/newkey?team=${App.team}`); toast('New stream key made'); paint(); } catch (e) { oops(e); }
          } }, 'New stream key') : null] : r.enabled ? h('p', { class: 'dim small' }, 'Producers and Admins see the stream key here.') : null);
    };
    paint();
    timer = setInterval(paint, 5000);
    box.repaint = paint;
    return box;
  }
  // ---- the matches in a production's stream: each one becomes its own video
  function matchesCard(doc) {
    const box = h('div', { class: 'card' });
    const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
    const local = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    const paint = async () => {
      const cur = App.docs.get(doc.id) || doc;
      const fx = (cur.data.fixtures || []).map((r) => App.docs.get(r.fixture)).filter(Boolean);
      if (!cur.data.streamSlug || !fx.length) { box.replaceChildren(); box.style.display = 'none'; return; }
      box.style.display = '';
      let r = { clips: [] };
      try { r = await api('GET', `/api/productions/${encodeURIComponent(doc.id)}/clips?team=${App.team}`); } catch (e) { /* show the matches anyway */ }
      const byFx = new Map(r.clips.map((c) => [c.fixture, c]));
      const send = async (fixture, body) => { try { await api('POST', `/api/productions/${encodeURIComponent(doc.id)}/clips?team=${App.team}`, { fixture, ...body }); paint(); } catch (e) { oops(e); } };
      const edit = App.canEdit('production') && App.cfg.mode === 'cloud';
      const watchBase = location.origin + '/watch/' + cur.data.streamSlug;
      box.replaceChildren(h('h2', {}, 'Matches in this stream'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'Stream the whole production on its one stream key. Each match becomes its own video: it is marked when its scorer starts the match (it turns Live) and when it ends (Completed), with 30 seconds either side. Set or correct the times here if a match was not scored.'),
        h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Match'), h('th', {}, 'Starts'), h('th', {}, 'Ends'), h('th', {}, 'Video'), edit ? h('th', {}, '') : null),
          fx.map((f) => {
            const c = byFx.get(f.id), v = c && c.video;
            const timeBox = (k) => h('input', { type: 'datetime-local', step: 1, value: local(c && c[k]), style: { width: '190px' }, onchange: (e) => send(f.id, { [k]: e.target.value ? new Date(e.target.value).toISOString() : '' }) });
            return h('tr', {}, h('td', {}, App.title('fixture', f.id), c && c.auto === false ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'set by hand') : null),
              h('td', {}, edit && c ? timeBox('start') : tm(c && c.start)), h('td', {}, edit && c && c.end ? timeBox('end') : c && c.start && !c.end ? h('span', { class: 'dim' }, 'running') : tm(c && c.end)),
              h('td', {}, v && v.duration ? h('a', { href: watchBase + '?m=' + encodeURIComponent(f.id), target: '_blank', rel: 'noopener' }, (v.live ? 'so far ' : '') + Math.round(v.duration / 60) + ' min ↗') : h('span', { class: 'dim' }, c ? 'not in a recording yet' : '—')),
              edit ? h('td', { class: 'nowrap' },
                !c || c.end ? h('button', { class: 'sm', onclick: () => send(f.id, { start: 'now', end: '' }) }, c ? 'Restart now' : 'Starts now') : h('button', { class: 'sm primary', onclick: () => send(f.id, { end: 'now' }) }, 'Ends now'),
                c ? h('button', { class: 'sm ghost', onclick: async () => { if (await confirmBox('Remove the marks of this match? Its video goes (the recording stays).')) send(f.id, { clear: true }); } }, 'Clear') : null) : null);
          })));
    };
    paint();
    box.repaint = paint;
    return box;
  }
  const prodPanel = App.panels.production;
  App.panels.production = (doc, form) => {
    const base = prodPanel(doc, form);
    const stream = App.docs.has(doc.id) && App.can('edit') && !App.cfg.bridge ? streamCard(doc) : null;
    const matches = stream ? matchesCard(doc) : null;
    const recs = stream && App.recordingsCard && App.cfg.mode === 'cloud' ? App.recordingsCard(doc) : null;
    const box = h('div', {}, stream, matches, recs, base);
    box.repaint = () => { if (base && base.repaint) base.repaint(); if (stream) stream.repaint(); if (matches) matches.repaint(); if (recs) recs.repaint(); };
    return box;
  };

  // ---- a channel: how it looks, its page, and the productions streaming on it
  App.panels.channel = (doc) => {
    const box = h('div', { class: 'card' });
    const paint = async () => {
      const d = (App.docs.get(doc.id) || doc).data;
      let r = { list: [], base: '' };
      try { r = await api('GET', '/api/streams?team=' + App.team); } catch (e) { /* no streams */ }
      const club = d.owner === 'Club' ? App.docs.get(d.club) : d.owner === 'Team' && App.docs.get(d.squad) ? App.docs.get(App.docs.get(d.squad).data.club) : null;
      const logo = d.logo || (club && club.data.image) || App.org().image || '';
      const color = d.color || (club && club.data.primaryColor) || App.org().accentColor || '#00ff82';
      const prods = App.list('production').filter((p) => p.data.streamChannel === doc.id).sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')));
      const page = (r.base || location.origin) + '/c/' + (d.slug || '');
      box.replaceChildren(
        h('div', { style: { borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--line)', marginBottom: '12px' } },
          h('div', { style: { height: '110px', background: d.banner && App.img(d.banner) ? `center / cover url(${App.img(d.banner)})` : `linear-gradient(120deg, ${color}, #151515)` } }),
          h('div', { class: 'row', style: { gap: '12px', padding: '10px 14px', alignItems: 'center' } },
            logo && App.img(logo) ? h('img', { src: App.img(logo), alt: '', style: { width: '56px', height: '56px', objectFit: 'contain', borderRadius: '50%', background: '#111', border: `3px solid ${color}` } }) : null,
            h('div', { style: { flex: 1 } }, h('b', { style: { fontSize: '18px' } }, d.name || 'Channel'), h('div', { class: 'dim small' }, [d.owner || 'Production company', (d.access || 'Public') === 'Public' ? 'on the public website' : d.access === 'Password' ? 'with a password' : 'team members only', d.disabled ? 'switched off' : ''].filter(Boolean).join(' · '))),
            h('button', { class: 'sm', onclick: () => copy(page) }, 'Copy channel link'), (d.access || 'Public') === 'Public' ? h('a', { class: 'btn sm primary', href: page, target: '_blank', rel: 'noopener' }, 'Channel page ↗') : null)),
        h('h3', {}, 'Productions streaming here'),
        prods.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, prods.map((p) => {
          const s = r.list.find((x) => x.id === p.id) || {};
          return h('tr', { class: 'click', onclick: () => { location.hash = '#/edit/production/' + p.id; } }, h('td', { class: 'nowrap' }, UI.fmtDate(p.data.date)), h('td', {}, h('b', {}, p.data.streamTitle || p.data.name)), h('td', {}, liveTag(s.live)), h('td', { class: 'dim small' }, s.videos ? `${s.videos} video${s.videos === 1 ? '' : 's'}` : ''));
        })))) : h('p', { class: 'dim', style: { margin: 0 } }, 'None yet. On a production, pick this channel under "Live stream on channel": each production gets its own stream key.'));
    };
    paint();
    box.repaint = paint;
    return box;
  };

  // ---- Settings → Server (the online website, for its site admins) -------------------------------
  App.serverTab = () => {
    const box = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const paint = async (made) => {
      let s;
      try { s = await api('GET', '/api/server/setup'); } catch (e) { box.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      if (!s.allowed) {
        const me = (App.user && App.user.email) || 'your email';
        box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Streaming server'),
          h('p', {}, s.streaming ? 'This website runs with a streaming server at ' + s.host + '.' : 'This website has no streaming server yet.'),
          h('p', {}, 'Only a site admin can set one up. ', s.siteAdmins ? 'You are not one of them.' : 'This website has no site admins yet.'),
          h('p', { class: 'dim' }, 'Where this website runs (Render → your service → Environment), add ', h('code', {}, 'SITE_ADMINS'), ' = ', h('code', {}, me), ' (several emails: comma between them), save, wait for the restart, then open this tab again.')));
        return;
      }
      box.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'Streaming server'),
          s.streaming ? h('p', {}, h('span', { class: 'led ' + (s.health.lastError ? 'bad' : 'ok') }), ' This website runs with a streaming server at ', h('b', {}, s.host), s.health.lastError ? ' — not answering: ' + s.health.lastError : '.') :
            h('p', {}, 'This website has no streaming server yet. Channels (Streaming → Channels) need one: it takes SRT and RTMP from OBS / vMix and plays to viewers on /watch pages.'),
          h('p', { class: 'dim' }, 'Set up a server: an Ubuntu 22.04 or 24.04 virtual machine (Oracle Cloud, Hetzner …). Running the command below on it installs this website, the streaming server and https on it, using the same database and Google sign-in as this website. Run it again later to update the server.')),
        h('div', { class: 'card' }, h('h2', {}, 'Setup command'),
          made ? h('div', {}, field('Command', made.command), h('p', { class: 'dim small' }, `Works until ${new Date(made.expires).toLocaleString('en-GB')}. Run it on the server (SSH, or paste it as the "cloud-init script" when you create the VM). It contains a link that hands out this website's database settings, so do not share it.`)) :
            s.expires ? h('p', { class: 'dim' }, `A setup link made by ${s.by} works until ${new Date(s.expires).toLocaleString('en-GB')}. Make a new one to see the command again (the old one stops working).`) : null,
          h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => { try { paint(await api('POST', '/api/server/setup')); } catch (e) { oops(e); } } }, made || s.expires ? 'Make a new setup command' : 'Make the setup command'),
            s.expires ? h('button', { class: 'ghost', onclick: async () => { try { await api('DELETE', '/api/server/setup'); toast('Setup link stopped'); paint(); } catch (e) { oops(e); } } }, 'Stop the setup link') : null)),
        h('div', { class: 'card' }, h('h2', {}, 'After it has run'),
          h('ol', { style: { margin: '0 0 0 18px', padding: 0, lineHeight: 1.8 } },
            h('li', {}, 'Open the server\'s firewall in the cloud console: TCP 80, 443, 1935, 8189 and UDP 443, 8189, 8890.'),
            h('li', {}, 'Google sign-in: add the server\'s https address to "Authorised JavaScript origins" of the OAuth client.'),
            h('li', {}, 'Use the server\'s address from then on, and link production PCs to it.'))));
    };
    paint();
    return box;
  };

  // ---- Streaming → Ticket sales (Producers and Admins)
  App.pages.sales = () => {
    const box = h('div', {}, pageHead('Ticket sales'), h('div', { class: 'card dim' }, 'Loading…'));
    const zar = (n) => 'ZAR ' + (Number(n) || 0).toFixed(2);
    api('GET', '/api/sales?team=' + App.team).then((r) => {
      const byItem = new Map();
      for (const x of r.list.filter((y) => y.status === 'Paid')) { const k = x.item; const o = byItem.get(k) || { item: k, n: 0, total: 0 }; o.n++; o.total += Number(x.amount) || 0; byItem.set(k, o); }
      box.replaceChildren(pageHead('Ticket sales'),
        !r.payments ? h('div', { class: 'card' }, h('h2', {}, 'Payments are not switched on'), h('p', { class: 'dim', style: { margin: 0 } }, 'Whoever runs this website adds the PayFast merchant details where it runs (PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE). Then set a ticket price on a production (Live stream) and optionally a pass on its channel.')) : null,
        r.sandbox ? h('div', { class: 'card' }, h('span', { class: 'pill warn' }, 'PayFast sandbox'), ' Test payments only: no real money moves.') : null,
        h('div', { class: 'card' }, h('div', { style: { display: 'flex', gap: '40px', flexWrap: 'wrap' } },
          h('div', {}, h('div', { class: 'dim small' }, 'Tickets and passes sold'), h('b', { style: { fontSize: '22px' } }, String(r.count))),
          h('div', {}, h('div', { class: 'dim small' }, 'Paid'), h('b', { style: { fontSize: '22px' } }, zar(r.total))),
          h('div', {}, h('div', { class: 'dim small' }, 'PayFast fees'), h('b', { style: { fontSize: '22px' } }, zar(Math.abs(r.fees)))))),
        byItem.size ? h('div', { class: 'card' }, h('h2', {}, 'Per stream / pass'), h('table', { class: 't' }, h('tr', {}, h('th', {}, 'What'), h('th', {}, 'Sold'), h('th', {}, 'Total')),
          [...byItem.values()].map((o) => h('tr', {}, h('td', {}, o.item), h('td', {}, String(o.n)), h('td', {}, zar(o.total)))))) : null,
        h('div', { class: 'card' }, h('h2', {}, 'All payments'), r.list.length ? h('table', { class: 't' }, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', {}, 'Who'), h('th', {}, 'Amount'), h('th', {}, 'Status')),
          r.list.map((x) => h('tr', {}, h('td', { class: 'nowrap' }, new Date(x.paidAt || x.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), h('td', {}, x.item),
            h('td', {}, [x.name, x.email].filter(Boolean).join(' · ')), h('td', { class: 'nowrap' }, zar(x.amount)), h('td', {}, h('span', { class: 'pill ' + (x.status === 'Paid' ? 'ok' : x.status === 'Pending' ? '' : 'warn') }, x.status))))) : h('p', { class: 'dim', style: { margin: 0 } }, 'Nothing sold yet.')));
    }).catch((e) => box.replaceChildren(pageHead('Ticket sales'), h('div', { class: 'card' }, e.message)));
    return { el: box };
  };
})();
