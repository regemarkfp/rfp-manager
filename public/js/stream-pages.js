/* Live streaming: a channel's stream settings (what to type into OBS / vMix), whether it is live, and the website's
 * "Server" settings tab that makes the one-line command to set up a streaming server. */
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
  App.panels.channel = (doc) => {
    const box = h('div', { class: 'card' }, h('div', { class: 'dim' }, 'Loading…'));
    let timer = null, alive = true;
    const paint = async () => {
      if (!box.isConnected && timer) { clearInterval(timer); alive = false; return; }
      let r;
      try { r = await api('GET', '/api/streams?team=' + App.team); } catch (e) { box.replaceChildren(h('p', { class: 'dim' }, e.message)); return; }
      const cur = App.docs.get(doc.id) || doc;
      const s = r.list.find((x) => x.id === doc.id) || {};
      const watch = (r.base || location.origin) + '/watch/' + (cur.data.slug || '');
      const ing = s.ingest;
      const kids = [
        h('div', { class: 'spread' },
          h('div', {}, h('h2', { style: { margin: 0 } }, 'Stream ', h('span', { class: 'pill ' + (s.live ? 'ok' : ''), style: s.live ? { background: '#ff3b3b', color: '#fff' } : {} }, s.live ? 'LIVE' : 'Offline')),
            h('div', { class: 'dim small' }, s.live ? `Live for ${ago(s.since)} · ${s.viewers} watching${s.kbps ? ` · ${(s.kbps / 1000).toFixed(1)} Mb/s in` : ''}${s.tracks && s.tracks.length ? ' · ' + s.tracks.join(', ') : ''}` : r.enabled ? 'Nothing is being sent to this channel right now.' : '')),
          h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => copy(watch) }, 'Copy watch link'), h('a', { class: 'btn sm primary', href: watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'))),
      ];
      if (!r.enabled) {
        kids.push(h('p', { class: 'dim', style: { marginBottom: 0 } }, 'This website has no streaming server yet. ', App.machine && App.machine.siteAdmin ? h('a', { href: '#/settings', onclick: () => { App.settingsTab = 'server'; } }, 'Set one up (Settings → Server)') : 'Ask whoever runs this website to set one up.', ' The channel and its stream key are kept and work as soon as the server is there.'));
      } else if (r.health && r.health.lastError) {
        kids.push(h('p', { class: 'pill warn' }, 'The streaming server is not answering: ' + r.health.lastError));
      }
      if (ing) {
        kids.push(
          h('h3', { style: { marginTop: '16px' } }, 'OBS, vMix, Wirecast … over RTMP'),
          field('Server', ing.rtmpServer), field('Stream key', ing.rtmpKey, true),
          h('h3', { style: { marginTop: '16px' } }, 'SRT (vMix, OBS, encoders, Larix on a phone)'),
          field('Host', ing.srtHost), field('Port', String(ing.srtPort)), field('Stream ID', ing.srtStreamId, true), field('Full SRT URL', ing.srtUrl, true),
          h('p', { class: 'dim small' }, 'vMix: Settings → Outputs/NDI/SRT (or Streaming → SRT), type Caller, then the host, port and stream ID above. OBS: Settings → Stream → Custom, paste the full SRT URL as the server and leave the key empty. SRT copes better with poor internet than RTMP. Video H.264, audio AAC (RTMP) or AAC/Opus; 2–6 Mb/s, keyframe every 2 seconds.'),
          App.can('edit') ? h('button', { class: 'sm danger', onclick: async () => {
            if (!(await confirmBox('Make a new stream key? Anything still using the old key stops streaming until you paste the new one.'))) return;
            try { await api('POST', `/api/channels/${encodeURIComponent(doc.id)}/newkey?team=${App.team}`); toast('New stream key made'); paint(); } catch (e) { oops(e); }
          } }, 'New stream key') : null);
      } else if (r.enabled) {
        kids.push(h('p', { class: 'dim small' }, 'Producers and Admins see the stream key here.'));
      }
      box.replaceChildren(...kids);
    };
    paint();
    timer = setInterval(() => { if (alive) paint(); }, 5000);
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
