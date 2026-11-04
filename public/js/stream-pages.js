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
          h('div', { class: 'row' }, App.canEdit('production') && App.mcrPanel && r.enabled ? h('button', { class: 'sm', onclick: () => App.mcrPanel(s) }, 'Master control') : null,
            h('button', { class: 'sm', onclick: () => copy(watch) }, 'Copy watch link'), h('a', { class: 'btn sm primary', href: watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'))),
        s.mcr && App.mcrStatus ? h('div', { class: 'mcr-pill ' + App.mcrStatus(s.mcr, Date.now()).cls, style: { marginTop: '8px' } }, App.mcrStatus(s.mcr, Date.now()).text) : null,
        restreamList(s),
        !r.enabled ? h('p', { class: 'dim', style: { marginBottom: 0 } }, 'This website has no streaming server yet. ', App.machine && App.machine.siteAdmin ? h('a', { href: '#/settings', onclick: () => { App.settingsTab = 'server'; } }, 'Set one up (Settings → Server)') : 'Ask whoever runs this website to set one up.', ' The stream key is kept and works as soon as the server is there.')
          : r.health && r.health.lastError ? h('p', { class: 'pill warn' }, 'The streaming server is not answering: ' + r.health.lastError) : null,
        ing ? [
          h('h3', { style: { marginTop: '16px' } }, 'OBS, vMix, Wirecast … over RTMP'),
          field('Server', ing.rtmpServer), field('Stream key', ing.rtmpKey, true),
          h('h3', { style: { marginTop: '16px' } }, 'SRT (vMix, OBS, encoders, Larix on a phone)'),
          field('Host', ing.srtHost), field('Port', String(ing.srtPort)), field('Stream ID', ing.srtStreamId, true), field('Full SRT URL', ing.srtUrl, true),
          h('p', { class: 'dim small' }, 'vMix: Settings → Outputs/NDI/SRT (or Streaming → SRT), type Caller, then the host, port and stream ID above. OBS: Settings → Stream → Custom, paste the full SRT URL as the server and leave the key empty. SRT copes better with poor internet than RTMP. Video H.264, audio AAC; 2–6 Mb/s, keyframe every 2 seconds.'),
          (cur.data.streamAudio || []).length ? h('div', { class: 'card', style: { background: 'var(--panel2)', margin: '12px 0' } },
            h('h3', { style: { marginTop: 0 } }, `Audio tracks (${cur.data.streamAudio.length})`),
            h('p', { class: 'small', style: { margin: '0 0 6px' } }, cur.data.streamAudio.map((r, i) => `${r.channels || ''} ${r.name || 'Track ' + (i + 1)}${r.audience && r.audience !== 'Everyone' ? ' (' + r.audience.toLowerCase() + ')' : ''}`).join('  ·  ')),
            h('div', { class: 'dim small', style: { margin: 0, whiteSpace: 'normal', lineHeight: 1.5 } }, 'Send them over SRT (RTMP carries one track only). OBS: Settings → Output → Output Mode Advanced → Recording → Type "Custom Output (FFmpeg)" → "Output to URL", paste the Full SRT URL above, Container format mpegts, video H.264, audio AAC, and tick audio tracks 1–', String(Math.min(6, cur.data.streamAudio.length)), ' (track 1 = 1+2, track 2 = 3+4 …). Then press Start Recording. vMix and hardware encoders: send an 8-channel (or multi-track) SRT stream; the pairs are split on the server. Viewers pick the track under the video, about 10 seconds after you start.')) : null,
          cur.data.streamClosed ? h('p', { class: 'pill warn', style: { marginTop: '12px' } }, 'This stream was ended and its key is closed: nothing can stream on it until you open it again.') : null,
          App.canEdit('production') ? h('div', { class: 'row', style: { gap: '8px', margin: '8px 0' } },
            cur.data.streamClosed ? h('button', { class: 'sm primary', onclick: async () => { if (await reopenStream(doc.id)) paint(); } }, 'Open the stream key again')
              : h('button', { class: 'sm danger', onclick: async () => { if (await endStream(doc.id, cur.data.streamTitle || cur.data.name)) paint(); } }, s.live ? 'End stream now' : 'Close the stream key')) : null,
          App.canEdit('production') ? h('button', { class: 'sm danger', onclick: async () => {
            if (!(await confirmBox('Make a new stream key? Anything still using the old key stops streaming until you paste the new one.'))) return;
            try { await api('POST', `/api/productions/${encodeURIComponent(doc.id)}/newkey?team=${App.team}`); toast('New stream key made'); paint(); } catch (e) { oops(e); }
          } }, 'New stream key') : null] : r.enabled ? h('p', { class: 'dim small' }, 'Producers and Admins see the stream key here.') : null,
        matchStreams(cur, r, paint));
    };
    paint();
    timer = setInterval(paint, 5000);
    box.repaint = paint;
    return box;
  }
  // restreams: where a copy of the stream goes (YouTube, Facebook …) and how it is doing
  const RS = { live: 'sending', retrying: 'trying again', starting: 'starting', waiting: 'starts when live', off: 'off', preparing: 'adding the graphics' };
  function restreamList(s) {
    if (!(s.restream || []).length) return null;
    return h('div', { style: { margin: '10px 0 0' } }, h('div', { class: 'dim small' }, 'Restreaming to'),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '4px' } }, s.restream.map((x) => h('span', { class: 'pill', title: (x.error ? x.error + ' · ' : '') + x.server,
        style: x.state === 'live' ? { background: '#1f6f3a', color: '#fff' } : x.state === 'retrying' ? { background: '#7a2020', color: '#fff' } : {} }, `${x.name}${x.with && !/^Clean/.test(x.with) ? ' (' + x.with.toLowerCase() + ')' : ''}: ${RS[x.state] || x.state}`))));
  }
  // one stream per match: each match's own key and watch page (several venues at once)
  const keysOpen = new Set();
  function matchStreams(cur, r, repaint) {
    const list = r.list.filter((x) => x.parent === cur.id);
    if (!cur.data.streamPerMatch && !list.length) return null;
    const can = App.canEdit('production');
    return h('div', { style: { marginTop: '18px' } },
      h('h3', {}, `Match streams (${list.length})`),
      !list.length ? h('p', { class: 'dim small' }, 'Add matches to this production (and save): each gets its own stream key and watch page here.') :
        list.map((m) => {
          const watch = (r.base || location.origin) + '/watch/' + m.slug, ing = m.ingest;
          const open = h('div', { style: { display: keysOpen.has(m.id) ? '' : 'none' } },
            ing ? [field('RTMP server', ing.rtmpServer), field('RTMP stream key', ing.rtmpKey, true), field('SRT URL', ing.srtUrl, true), field('SRT stream ID', ing.srtStreamId, true)] : null);
          return h('div', { class: 'card', style: { background: 'var(--panel2)', margin: '8px 0', padding: '10px 12px' } },
            h('div', { class: 'spread' },
              h('div', {}, h('b', {}, m.title), ' ', liveTag(m.live), m.closed ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'key closed') : null,
                h('div', { class: 'dim small' }, m.live ? `live for ${ago(m.since)} · ${m.viewers} watching${m.source ? ' · ' + m.source : ''}` : '/watch/' + m.slug)),
              h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
                ing ? h('button', { class: 'sm ghost', onclick: (e) => { const o = open.style.display === 'none'; open.style.display = o ? '' : 'none'; if (o) keysOpen.add(m.id); else keysOpen.delete(m.id); e.target.textContent = o ? 'Hide keys' : 'Stream keys'; } }, keysOpen.has(m.id) ? 'Hide keys' : 'Stream keys') : null,
                can && App.mcrPanel ? h('button', { class: 'sm', onclick: () => App.mcrPanel(m) }, 'Master control') : null,
                h('button', { class: 'sm', onclick: () => copy(watch) }, 'Copy link'),
                h('a', { class: 'btn sm', href: watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'),
                can ? (m.closed ? h('button', { class: 'sm', onclick: async () => { if (await reopenStream(m.id)) repaint(); } }, 'Open key') : h('button', { class: 'sm danger', onclick: async () => { if (await endStream(m.id, m.title)) repaint(); } }, m.live ? 'End' : 'Close key')) : null,
                can ? h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox('Make a new stream key for this match? Whatever uses the old one stops.', 'New key'))) return; try { await api('POST', `/api/productions/${encodeURIComponent(m.id)}/newkey?team=${App.team}`); toast('New key made'); repaint(); } catch (e) { oops(e); } } }, 'New key') : null)),
            m.mcr && App.mcrStatus ? h('div', { class: 'mcr-pill ' + App.mcrStatus(m.mcr, Date.now()).cls, style: { marginTop: '6px' } }, App.mcrStatus(m.mcr, Date.now()).text) : null,
            restreamList(m), open);
        }));
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

  // push notifications for the apps: the two Firebase files (the site admin uploads them once)
  function pushCard() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Push notifications (Android app)'), h('div', { class: 'dim' }, 'Loading…'));
    const read = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });
    const pick = (key, label) => {
      const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onchange: async () => {
        if (!inp.files[0]) return;
        try { await api('POST', '/api/push/config', { [key]: await read(inp.files[0]) }); toast('Saved'); paint(); } catch (e) { oops(e); }
      } });
      return [h('button', { class: 'sm', onclick: () => inp.click() }, label), inp];
    };
    const paint = async () => {
      let c;
      try { c = await api('GET', '/api/push/config'); } catch (e) { box.replaceChildren(h('h2', {}, 'Push notifications'), h('p', { class: 'dim' }, e.message)); return; }
      box.replaceChildren(h('h2', {}, 'Push notifications (Android app)'),
        h('p', {}, h('span', { class: 'led ' + (c.fcm && c.android ? 'ok' : 'bad') }), ' ', c.fcm && c.android ? `On, with the Firebase project ${c.project}.` : 'Not set up yet: the Android app works, without push notifications.',
          c.windows ? ` ${c.windows} production PC${c.windows === 1 ? '' : 's'} connected for Windows notifications.` : ''),
        h('ol', { style: { margin: '0 0 10px 18px', padding: 0, lineHeight: 1.7 } },
          h('li', {}, 'console.firebase.google.com → Add project (free; Google Analytics not needed).'),
          h('li', {}, 'Add app → Android, package name ', h('code', {}, 'com.regemarkfp.rfpmanager'), ' → Register → Download google-services.json → upload it below.'),
          h('li', {}, 'Project settings → Service accounts → Generate new private key → upload that file below. Keep it secret: it lets this website send notifications.')),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          pick('googleServices', c.android ? '✓ google-services.json (replace)' : 'Upload google-services.json'),
          pick('serviceAccount', c.fcm ? '✓ Service account key (replace)' : 'Upload the service account key')),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Windows notifications need nothing here: production PCs linked to this website get them while RFP Manager runs.'));
    };
    paint();
    return box;
  }
  // ---- WhatsApp Business (Meta's Cloud API): replies on bookings go by WhatsApp as well as email
  function whatsappCard() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'WhatsApp (booking messages)'), h('div', { class: 'dim' }, 'Loading…'));
    const paint = async () => {
      let c;
      try { c = await api('GET', '/api/whatsapp/config'); } catch (e) { box.replaceChildren(h('h2', {}, 'WhatsApp'), h('p', { class: 'dim' }, e.message)); return; }
      const inp = (v, attrs = {}) => h('input', { value: v || '', ...attrs });
      const f = { phoneNumberId: inp(c.phoneNumberId, { placeholder: 'e.g. 123456789012345', inputmode: 'numeric' }), token: inp('', { type: 'password', placeholder: c.hasToken ? '•••••• saved (type a new one to replace it)' : 'Paste the permanent access token', autocomplete: 'off' }),
        appSecret: inp('', { type: 'password', placeholder: c.hasSecret ? '•••••• saved' : 'Optional: checks that messages really come from Meta', autocomplete: 'off' }),
        template: inp(c.template, { placeholder: 'booking_update' }), lang: inp(c.lang, { placeholder: 'en', style: { width: '80px' } }), country: inp(c.country, { placeholder: '27', style: { width: '80px' } }), number: inp(c.number, { placeholder: '+27 …' }) };
      const field = (label, el, help) => h('label', { class: 'fld', style: { display: 'block', marginBottom: '10px' } }, h('div', { class: 'dim small' }, label), el, help ? h('div', { class: 'dim small' }, help) : null);
      const copyable = (v) => h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { readonly: true, value: v, onfocus: (e) => e.target.select(), style: { flex: 1, minWidth: 0 } }), h('button', { class: 'sm', onclick: () => navigator.clipboard.writeText(v).then(() => toast('Copied')).catch(() => {}) }, 'Copy'));
      const testTo = inp('', { type: 'tel', placeholder: 'Your own number, e.g. 082 …' });
      box.replaceChildren(h('h2', {}, 'WhatsApp (booking messages)'),
        h('p', {}, h('span', { class: 'led ' + (c.on ? 'ok' : 'bad') }), ' ', c.on ? `On${c.number ? ' – sending from ' + c.number : ''}. Replies on booking requests and their step updates go by WhatsApp as well as email.` : 'Not set up yet: booking messages go by email only.'),
        h('details', { open: !c.on ? '' : null }, h('summary', {}, 'How to set it up (Meta, once)'),
          h('ol', { style: { margin: '8px 0 10px 18px', padding: 0, lineHeight: 1.7 } },
            h('li', {}, 'developers.facebook.com → My apps → Create app → type Business → add the product WhatsApp. Link it to your Meta Business account (RegemarkFP).'),
            h('li', {}, 'WhatsApp → API setup: add your business phone number (a number not already on the WhatsApp app) and verify it. Copy its Phone number ID below.'),
            h('li', {}, 'business.facebook.com → Settings → Users → System users → Add (Admin) → Assign assets: the app and the WhatsApp account (full control) → Generate token with whatsapp_business_messaging and whatsapp_business_management, never expires. Paste it below yourself. It is a secret.'),
            h('li', {}, 'WhatsApp Manager → Message templates → Create: category Utility, name ', h('code', {}, c.template || 'booking_update'), ', language English, body:', h('br'),
              h('code', {}, 'Hi {{1}}, there is an update on {{2}}: {{3}} Follow your booking here: {{4}}'), h('br'), 'WhatsApp only lets us start a conversation with an approved template; once the client answers, replies go as normal messages for 24 hours.'),
            h('li', {}, 'WhatsApp → Configuration → Webhook: Callback URL and Verify token below → Verify and save → subscribe to ', h('code', {}, 'messages'), '. Then the clients\' answers and the delivery ticks come back to the booking.'),
            h('li', {}, 'Add a payment method in WhatsApp Manager: Meta charges per conversation (service replies to a client who wrote first are free).'))),
        field('Phone number ID', f.phoneNumberId), field('Access token', f.token), field('Message template name and language', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, f.template, f.lang)),
        field('Country code for numbers starting with 0', f.country, 'Clients type 068 …; WhatsApp needs 2768 ….'), field('Your WhatsApp business number (shown here only)', f.number),
        field('App secret (App settings → Basic)', f.appSecret),
        field('Webhook callback URL', copyable(c.webhook)), field('Webhook verify token', copyable(c.verifyToken)),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'primary', onclick: async () => { try { await api('POST', '/api/whatsapp/config', { phoneNumberId: f.phoneNumberId.value, token: f.token.value, appSecret: f.appSecret.value, template: f.template.value, lang: f.lang.value, country: f.country.value, number: f.number.value }); toast('Saved'); App.cfg.whatsapp = true; paint(); } catch (e) { oops(e); } } }, 'Save'),
          c.hasToken ? h('button', { class: 'danger sm', onclick: async () => { try { await api('POST', '/api/whatsapp/config', { clearToken: true }); toast('Token removed: WhatsApp is off'); App.cfg.whatsapp = false; paint(); } catch (e) { oops(e); } } }, 'Remove the token') : null),
        c.on ? h('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'nowrap' } }, testTo, h('button', { onclick: async () => {
          try { const r = await api('POST', '/api/whatsapp/test', { phone: testTo.value }); if (r.ok) toast(r.kind === 'template' ? 'Sent with the template – check your WhatsApp' : 'Sent – check your WhatsApp'); else UI.modal({ title: 'WhatsApp did not send it', body: h('p', {}, r.error || 'Unknown error'), actions: [{ label: 'OK', primary: true }] }); } catch (e) { oops(e); }
        } }, 'Send a test')) : null);
    };
    paint();
    return box;
  }
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
        pushCard(),
        whatsappCard(),
        h('div', { class: 'card' }, h('h2', {}, 'After it has run'),
          h('ol', { style: { margin: '0 0 0 18px', padding: 0, lineHeight: 1.8 } },
            h('li', {}, 'Open the server\'s firewall in the cloud console: TCP 80, 443, 1935, 8189 and UDP 443, 8189, 8890.'),
            h('li', {}, 'Google sign-in: add the server\'s https address to "Authorised JavaScript origins" of the OAuth client.'),
            h('li', {}, 'Use the server\'s address from then on, and link production PCs to it.'))));
    };
    paint();
    return box;
  };

  // ---- Streaming → Live streams: every stream of the team at a glance; end one (its key closes) or open it again
  const endStream = async (id, title) => {
    if (!(await confirmBox(`End "${title}" now? The camera or encoder is cut off, viewers see that the stream has ended, and its stream key stays closed until you open it again.`, 'End stream'))) return false;
    try { const r = await api('POST', `/api/productions/${encodeURIComponent(id)}/stream/end?team=${App.team}`); if (r.doc) App.docs.set(r.doc.id, r.doc); toast(r.kicked ? 'Stream ended and the key closed' : 'Key closed (nothing was streaming)'); return true; } catch (e) { oops(e); return false; }
  };
  const reopenStream = async (id) => {
    try { const r = await api('POST', `/api/productions/${encodeURIComponent(id)}/stream/reopen?team=${App.team}`); if (r.doc) App.docs.set(r.doc.id, r.doc); toast('Stream key open: you can stream again'); return true; } catch (e) { oops(e); return false; }
  };
  App.endStream = endStream; App.reopenStream = reopenStream;
  // ---- setting up a stream: on an existing production, or a new production made for it (with a match if picked).
  // The stream lives on the production, so whatever is set here shows on the production and the other way round.
  const streamFields = () => Schema.fieldsFor('production', App.org()).filter((f) => f.group === 'Live stream' && !f.hidden);
  const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const showKeys = (doc) => UI.modal({ title: `Stream key: ${doc.data.streamTitle || doc.data.name}`, wide: true, body: streamCard(doc), actions: [{ label: 'Done' }] });
  App.streamSetup = (prodId, onDone) => {
    const cur = prodId ? App.docs.get(prodId) : null;
    const prods = App.list('production').filter((d) => !d.data.streamChannel).sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')));
    const fixtures = App.list('fixture').filter((d) => !d.data.startDate || d.data.startDate >= todayIso()).sort((a, b) => String(a.data.startDate || '').localeCompare(String(b.data.startDate || '')));
    const channels = App.sorted('channel');
    let mode = cur ? 'edit' : 'new', target = '', match = '';
    const top = h('div', {}), formBox = h('div', {});
    const base = [{ k: 'name', l: 'Production name', t: 'text', ph: 'From the match if you pick one' }, { k: 'date', l: 'Date', t: 'date' }, { k: 'txTime', l: 'TX / start time', t: 'time' }, { k: 'venue', l: 'Venue', t: 'ref', ref: 'venue' }];
    let form = null;
    const build = () => {
      const fields = mode === 'new' ? [...base, ...streamFields()] : streamFields();
      const init = mode === 'edit' ? cur.data : mode === 'existing' && target ? App.docs.get(target).data : {};
      const start = { ...init };
      if (!start.streamChannel && channels.length === 1) start.streamChannel = channels[0].id;
      form = buildForm('production', start, { fields });
      formBox.replaceChildren(form.el);
    };
    const pick = (m) => { mode = m; paintTop(); build(); };
    function paintTop() {
      if (cur) { top.replaceChildren(h('p', { class: 'dim', style: { marginTop: 0 } }, 'These are the stream settings of the production "', h('b', {}, cur.data.name), '": changing them here changes the production.')); return; }
      top.replaceChildren(
        h('div', { class: 'tabs', style: { marginBottom: '10px' } }, h('button', { class: mode === 'new' ? 'on' : '', onclick: () => pick('new') }, 'New production'), h('button', { class: mode === 'existing' ? 'on' : '', disabled: !prods.length, onclick: () => pick('existing') }, `Existing production (${prods.length})`)),
        mode === 'new' ? h('label', { class: 'f' }, h('span', {}, 'Match (optional)'), h('select', { onchange: (e) => {
          match = e.target.value; const f = match && App.get(match);
          if (f && form) { const d = form.data; if (!d.name) d.name = App.fixtureName(f); if (!d.date) d.date = f.startDate || ''; if (!d.txTime) d.txTime = f.startTime || ''; if (!d.venue) d.venue = f.venue || ''; form.repaint(); }
        } }, h('option', { value: '' }, '– no match: an event, a service, a concert … –'), fixtures.map((d) => h('option', { value: d.id, selected: d.id === match }, `${d.data.startDate || ''} ${App.fixtureName(d.data)}`))),
        h('div', { class: 'help' }, 'Makes the production with this match in it, so the scorer, graphics and the report know it.'))
          : h('label', { class: 'f' }, h('span', {}, 'Production'), h('select', { onchange: (e) => { target = e.target.value; build(); } }, h('option', { value: '' }, '– pick a production –'), prods.map((d) => h('option', { value: d.id, selected: d.id === target }, `${d.data.date || ''} ${d.data.name}`)))));
    }
    paintTop(); build();
    if (!channels.length) formBox.prepend(h('p', { class: 'pill warn', style: { whiteSpace: 'normal' } }, 'You have no channel yet: make one under Streaming → Channels first (a stream always plays on a channel).'));
    UI.modal({ title: cur ? 'Stream settings' : 'New live stream', wide: true, body: h('div', {}, top, formBox), actions: [{ label: 'Cancel' }, { label: cur ? 'Save' : 'Create stream', primary: true, onClick: async () => {
      const d = form.data;
      if (!d.streamChannel) { toast('Pick the channel it streams on', 'error'); return false; }
      let doc;
      if (mode === 'edit') doc = await App.save('production', cur.id, { ...App.docs.get(cur.id).data, ...d });
      else if (mode === 'existing') { if (!target) { toast('Pick a production', 'error'); return false; } doc = await App.save('production', target, { ...App.docs.get(target).data, ...d }); }
      else {
        const f = match && App.get(match);
        const name = d.name || (f ? App.fixtureName(f) : '') || d.streamTitle;
        if (!name) { toast('Give the production a name (or pick a match)', 'error'); return false; }
        doc = await App.save('production', App.newId('production'), { type: f ? 'Sport' : 'Other', ...d, name, date: d.date || todayIso(), fixtures: f ? [{ fixture: match }] : [] });
      }
      toast(cur ? 'Stream settings saved' : 'Stream ready: here is what to put in OBS / vMix');
      if (onDone) onDone(doc);
      if (!cur) setTimeout(() => showKeys(doc), 50);
    } }] });
  };
  let liveFilter = 'Live';
  App.pages.streams = () => {
    const tabs = h('div', { class: 'tabs' }), body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    let timer = null, first = true;
    const paint = async () => {
      if (!body.isConnected && timer) { clearInterval(timer); return; }
      let r;
      try { r = await api('GET', '/api/streams?team=' + App.team); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const rows = r.list.map((s) => ({ ...s, doc: App.docs.get(s.parent || s.id) })).filter((s) => s.doc);
      const today = todayIso();
      const groups = { Live: rows.filter((s) => s.live), Upcoming: rows.filter((s) => !s.live && !s.closed && (s.doc.data.date || '') >= today), Closed: rows.filter((s) => s.closed && !s.live), All: rows };
      if (first) { first = false; if (!groups.Live.length && liveFilter === 'Live' && groups.Upcoming.length) liveFilter = 'Upcoming'; }
      tabs.replaceChildren(...Object.keys(groups).map((t) => h('button', { class: t === liveFilter ? 'on' : '', onclick: () => { liveFilter = t; paint(); } }, `${t} (${groups[t].length})`)));
      const list = groups[liveFilter].sort((a, b) => (b.live - a.live) || (liveFilter === 'Upcoming' ? -1 : 1) * String(b.doc.data.date || '').localeCompare(String(a.doc.data.date || '')));
      const can = App.canEdit('production');
      const card = (s) => {
        const d = s.doc.data, ch = App.docs.get(d.streamChannel);
        const watch = (r.base || location.origin) + '/watch/' + s.slug;
        const name = s.title || d.streamTitle || d.name;
        const ms = App.mcrStatus ? App.mcrStatus(s.mcr, Date.now()) : null;
        const state = s.live ? h('span', { class: 'pill', style: { background: '#ff3b3b', color: '#fff' } }, 'LIVE') : s.closed ? h('span', { class: 'pill warn' }, 'Ended · key closed') : h('span', { class: 'pill' }, 'Offline');
        const poster = App.img(d.streamPoster) || (ch && App.img(ch.data.banner)) || '';
        return h('div', { class: 'card', style: { margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' } },
          h('div', { style: { aspectRatio: '16 / 9', borderRadius: '8px', background: poster ? `center / cover url(${poster})` : 'linear-gradient(135deg, #222, #111)', position: 'relative', overflow: 'hidden' } },
            h('div', { style: { position: 'absolute', left: '8px', top: '8px' } }, state),
            s.live ? h('div', { class: 'small', style: { position: 'absolute', right: '8px', bottom: '8px', background: 'rgba(0,0,0,.7)', padding: '3px 8px', borderRadius: '6px' } }, `${ago(s.since)} · ${s.viewers || 0} watching`) : null),
          h('div', {}, h('b', {}, name), h('div', { class: 'dim small' }, [s.parent ? (d.streamTitle || d.name) : '', ch ? ch.data.name : '', UI.fmtDate(d.date)].filter(Boolean).join(' · '))),
          ms ? h('div', { class: 'mcr-pill ' + ms.cls }, ms.text) : null,
          (s.restream || []).length ? h('div', { class: 'small' }, s.restream.map((x) => h('span', { class: 'pill', title: x.error || x.server, style: { marginRight: '4px', ...(x.state === 'live' ? { background: '#1f6f3a', color: '#fff' } : x.state === 'retrying' ? { background: '#7a2020', color: '#fff' } : {}) } }, `${x.name}${x.with && !/^Clean/.test(x.with) ? ' · ' + x.with.toLowerCase() : ''}: ${{ live: 'sending', retrying: 'trying again', starting: 'starting', waiting: 'when live', off: 'off', preparing: 'adding graphics' }[x.state] || x.state}`))) : null,
          s.live ? h('div', { class: 'dim small' }, [s.source && 'In: ' + s.source, s.kbps ? (s.kbps / 1000).toFixed(1) + ' Mb/s' : '', (s.tracks || []).join(', '), s.audioTracks ? s.audioTracks + ' audio tracks' : ''].filter(Boolean).join(' · ')) : s.closed && s.endedAt ? h('div', { class: 'dim small' }, 'Ended ' + new Date(s.endedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : null,
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: 'auto' } },
            h('a', { class: 'btn sm', href: watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'),
            h('a', { class: 'btn sm', href: '#/edit/production/' + (s.parent || s.id) }, 'Production'),
            can ? h('button', { class: 'sm', onclick: () => App.streamSetup(s.parent || s.id, () => paint()) }, 'Settings') : null,
            can && !s.parent ? h('button', { class: 'sm', onclick: () => showKeys(App.docs.get(s.id)) }, 'Stream key') : null,
            can && App.mcrPanel ? h('button', { class: 'sm primary', onclick: () => App.mcrPanel(s) }, 'Master control') : null,
            can && (s.live || !s.closed) ? h('button', { class: 'sm danger', onclick: async () => { if (await endStream(s.id, name)) paint(); } }, 'End stream') : null,
            can && s.closed ? h('button', { class: 'sm', onclick: async () => { if (await reopenStream(s.id)) paint(); } }, 'Open key again') : null));
      };
      body.replaceChildren(list.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' } }, list.map(card))
        : h('div', { class: 'card empty' }, liveFilter === 'Live' ? 'Nothing is live right now. Streams show up here the moment a camera or encoder connects.' : liveFilter === 'Upcoming' ? 'No streams coming up. Set one up with "New stream".' : 'None.'),
        !r.enabled ? h('p', { class: 'dim' }, 'This website has no streaming server yet.') : r.health && r.health.lastError ? h('p', { class: 'pill warn' }, 'The streaming server is not answering: ' + r.health.lastError) : null);
    };
    paint();
    timer = setInterval(paint, 5000);
    return { el: h('div', {}, pageHead('Live streams', App.canEdit('production') ? h('button', { class: 'primary', onclick: () => App.streamSetup('', () => { liveFilter = 'Upcoming'; paint(); }) }, '+ New stream') : null), h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Every stream of your production team, matches streaming on their own included. New stream sets one up on a new or existing production (the stream settings live on the production, so changes show in both places). Master control puts slates, ad breaks and graphics on what viewers see in the app (the stream and recording stay clean). End stream cuts the camera off, shows viewers that it has ended and closes the stream key until you open it again.'), tabs, body), keepScroll: true, destroy: () => clearInterval(timer) };
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
