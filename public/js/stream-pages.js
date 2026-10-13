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
  const prodPanel = App.panels.production;
  App.panels.production = (doc, form) => {
    const base = prodPanel(doc, form);
    const stream = App.docs.has(doc.id) && App.can('edit') && !App.cfg.bridge ? streamCard(doc) : null;
    const box = h('div', {}, stream, base);
    box.repaint = () => { if (base && base.repaint) base.repaint(); if (stream) stream.repaint(); };
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
})();
