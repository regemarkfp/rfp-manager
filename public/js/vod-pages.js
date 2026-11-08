/* Streaming → Videos & series: upload videos (in 8 MB pieces, so big files get through and a dropped connection
 * carries on from where it was), see them being processed, put them in series with seasons and episodes, price them. */
'use strict';
(() => {
  // uploads keep going while you look at other screens; they are listed here until done
  const uploads = [];            // { id, name, size, sent, state: 'waiting'|'sending'|'done'|'failed'|'stopped', error, file, meta }
  let running = false, chunk = 8 * 1024 * 1024, repaint = () => {};
  const size = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const dur = (s) => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return s ? (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0') : ''; };
  const ep = (d) => [d.season ? 'S' + d.season : '', d.episode ? 'E' + d.episode : ''].join(' ').trim();
  const site = () => location.origin;
  const busy = () => uploads.some((u) => ['waiting', 'sending'].includes(u.state));
  window.addEventListener('beforeunload', (e) => { if (busy()) { e.preventDefault(); e.returnValue = ''; } });

  async function putChunk(u, offset, blob) {
    const res = await fetch(`/api/vod/${u.id}/upload?team=${App.team}&offset=${offset}`, { method: 'PUT', credentials: 'same-origin', headers: { 'x-rfp': '1', 'content-type': 'application/octet-stream' }, body: blob });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || 'Upload failed (' + res.status + ')'); e.status = res.status; throw e; }
    return j;
  }
  async function send1(u) {
    u.state = 'sending'; repaint();
    try {
      if (!u.id) {
        const r = await api('POST', '/api/vod?team=' + App.team, { name: u.file.name, size: u.file.size, mime: u.file.type, ...u.meta });
        u.id = r.doc.id; chunk = r.chunk || chunk;
        App.docs.set(r.doc.id, r.doc);
      } else {
        u.sent = (await api('GET', `/api/vod/${u.id}/upload?team=${App.team}`)).received || 0;     // carry on from what arrived
      }
      while (u.sent < u.size) {
        if (u.state === 'stopped') return;
        const part = u.file.slice(u.sent, Math.min(u.size, u.sent + chunk));
        let tries = 0;
        for (;;) {
          try { u.sent = (await putChunk(u, u.sent, part)).received; break; } catch (e) {
            if (e.status === 409 && /Send from byte (\d+)/.test(e.message)) { u.sent = Number(/Send from byte (\d+)/.exec(e.message)[1]); break; }
            if (++tries >= 6 || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429)) throw e;
            await new Promise((r) => setTimeout(r, 1500 * tries));          // the connection dropped: try that piece again
          }
        }
        repaint();
      }
      await api('POST', `/api/vod/${u.id}/done?team=${App.team}`);
      u.state = 'done';
      toast(u.file.name + ' uploaded – it is being processed');
    } catch (e) { u.state = 'failed'; u.error = e.message; }
    repaint();
  }
  async function pump() {
    if (running) return;
    running = true;
    try { for (let u = uploads.find((x) => x.state === 'waiting'); u; u = uploads.find((x) => x.state === 'waiting')) await send1(u); } finally { running = false; }
    repaint();
  }

  // choosing files: which channel, which series (and season / first episode number), who sees them
  function chooseFiles(files, preset = {}) {
    if (!files.length) return;
    const chans = App.sorted('channel');
    if (!chans.length) { toast('Make a channel first (Streaming → Channels)', 'error'); return; }
    const sers = App.sorted('vodseries');
    const meta = { channel: preset.channel || (chans[0] && chans[0].id), series: preset.series || '', season: preset.season || 1, episode: preset.episode || '', visibility: 'Public' };
    if (meta.series) { const s = App.get(meta.series); if (s && s.channel) meta.channel = s.channel; }
    const sel = (opts, k, after) => h('select', { onchange: (e) => { meta[k] = e.target.value; if (after) after(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(meta[k]) === String(v) }, t)));
    const nextEp = () => { const eps = App.list('vodvideo').filter((v) => v.data.series === meta.series && Number(v.data.season || 1) === Number(meta.season || 1)); return eps.reduce((m, v) => Math.max(m, Number(v.data.episode) || 0), 0) + 1; };
    if (meta.series && !meta.episode) meta.episode = nextEp();
    const epBox = h('input', { type: 'number', min: 1, value: meta.episode, oninput: (e) => { meta.episode = e.target.value; } });
    const seriesBits = h('div', { class: 'row', style: { gap: '10px' } });
    const paintSeries = () => {
      if (meta.series && !preset.episode) { meta.episode = nextEp(); epBox.value = meta.episode; }
      seriesBits.replaceChildren(...(meta.series ? [h('label', { class: 'f' }, h('span', {}, 'Season'), h('input', { type: 'number', min: 1, value: meta.season, oninput: (e) => { meta.season = e.target.value; if (!preset.episode) { meta.episode = nextEp(); epBox.value = meta.episode; } } })),
        h('label', { class: 'f' }, h('span', {}, files.length > 1 ? 'First episode number' : 'Episode'), epBox)] : []));
    };
    paintSeries();
    const total = [...files].reduce((n, f) => n + f.size, 0);
    modal({ title: files.length > 1 ? `Upload ${files.length} videos` : 'Upload a video', body: h('div', { class: 'stack' },
      h('p', { class: 'dim', style: { marginTop: 0 } }, [...files].map((f) => f.name).slice(0, 6).join(', ') + (files.length > 6 ? ` and ${files.length - 6} more` : '') + ` · ${size(total)}`),
      h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, 'Channel'), sel(chans.map((c) => [c.id, c.data.name]), 'channel')),
        h('label', { class: 'f' }, h('span', {}, 'Who sees it'), sel([['Public', 'Public'], ['Unlisted', 'Unlisted (link only)'], ['Hidden', 'Hidden (only us)']], 'visibility')),
        h('label', { class: 'f' }, h('span', {}, 'Series'), sel([['', '— not in a series —'], ...sers.map((s) => [s.id, s.data.title])], 'series', paintSeries)), seriesBits),
      h('p', { class: 'help' }, 'Titles come from the file names; change them, add a description, poster and price afterwards. Keep this tab open while it uploads (other screens are fine).')),
    actions: [{ label: 'Cancel' }, { label: 'Upload', primary: true, onClick: () => {
      let n = Number(meta.episode) || 0;
      for (const f of files) uploads.push({ name: f.name, size: f.size, sent: 0, state: 'waiting', file: f, meta: { ...meta, episode: meta.series && n ? n++ : '' } });
      pump(); repaint();
    } }] });
  }
  const picker = (preset) => {
    const inp = h('input', { type: 'file', accept: 'video/*,.mkv,.mts,.m2ts,.mxf,.ts', multiple: true, class: 'hide', onchange: () => { chooseFiles([...inp.files], preset); inp.value = ''; } });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  };

  App.pages.vod = (tab) => {
    tab = tab === 'series' ? 'series' : 'videos';
    const body = h('div', { 'data-nosubnav': '' }, h('div', { class: 'card dim' }, 'Loading…'));
    const upBox = h('div', {});
    let files = new Map(), info = { ffmpeg: true }, filter = '', timer = null;
    const can = App.canEdit('vodvideo');
    const load = async () => {
      try { const r = await api('GET', '/api/vod?team=' + App.team); files = new Map(r.list.map((x) => [x.id, x.file])); info = r; } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return false; }
      return true;
    };
    const paintUploads = () => {
      const list = uploads.filter((u) => u.state !== 'done' || Date.now() - (u.doneAt || (u.doneAt = Date.now())) < 8000);
      upBox.replaceChildren(list.length ? h('div', { class: 'card' }, h('h2', {}, 'Uploading'), list.map((u) => h('div', { class: 'vod-up' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, u.name), h('span', { class: 'dim small' }, u.state === 'failed' ? '' : `${size(u.sent)} of ${size(u.size)}`)),
        h('div', { class: 'meter' }, h('span', { style: { width: Math.round(u.sent / u.size * 100) + '%' } })),
        u.state === 'failed' ? h('div', { class: 'row' }, h('span', { class: 'pill bad' }, 'Stopped'), h('span', { class: 'small' }, u.error), h('button', { class: 'sm', onclick: () => { u.state = 'waiting'; u.error = ''; pump(); } }, 'Try again'))
          : u.state === 'waiting' ? h('span', { class: 'dim small' }, 'Waiting…') : u.state === 'done' ? h('span', { class: 'pill ok' }, 'Uploaded ✓') : null))) : '');
    };
    const state = (f) => f && f.youtube ? h('span', { class: 'pill cms-yt' }, 'YouTube') : !f ? h('span', { class: 'pill warn' }, 'No file')
      : f.status === 'ready' ? (f.note && /may not play/.test(f.note) ? h('span', { class: 'pill warn', title: f.note }, 'Ready – check it plays') : h('span', { class: 'pill ok' }, 'Ready'))
        : f.status === 'processing' ? h('span', { class: 'pill' }, `Processing ${f.progress || 0}%`)
          : f.status === 'uploading' ? h('span', { class: 'pill' }, `Uploading ${f.size ? Math.round((f.received || 0) / f.size * 100) : 0}%`)
            : h('span', { class: 'pill bad', title: f.error }, 'Failed');
    const posterOf = (v, f) => App.img(v.data.poster) || v.data.ytPoster || (f && f.poster ? `/vodfiles/${v.id}/poster.jpg` : '');
    // a YouTube video has no file of ours: it is ready as it is
    const fileOf = (v) => (v.data.source === 'YouTube' ? { status: 'ready', youtube: true, duration: v.data.duration || 0 } : files.get(v.id));
    const videoCard = (v) => {
      const d = v.data, f = fileOf(v), s = d.series && App.get(d.series), ch = App.get(d.channel), p = posterOf(v, f);
      return h('div', { class: 'card vod-card' },
        h('div', { class: 'vod-thumb', style: { backgroundImage: p ? `url("${p}")` : '' } }, f && f.duration ? h('span', { class: 'vod-dur' }, dur(f.duration)) : null, h('span', { class: 'vod-state' }, state(f))),
        h('div', {}, h('b', {}, d.title), h('div', { class: 'dim small' }, [s ? s.title + (ep(d) ? ' · ' + ep(d) : '') : '', ch ? ch.name : '', d.visibility && d.visibility !== 'Public' ? d.visibility : '', Number(d.price) > 0 ? 'R ' + d.price : d.freeInSeries ? 'Free in series' : '', f && f.views ? f.views + ' views' : ''].filter(Boolean).join(' · ')),
          f && f.status === 'failed' ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, f.error) : f && f.note ? h('div', { class: 'dim small' }, f.note) : null),
        h('div', { class: 'row', style: { gap: '6px', marginTop: 'auto' } },
          can ? h('a', { class: 'btn sm', href: '#/edit/vodvideo/' + v.id }, 'Edit') : null,
          f && f.status === 'ready' && d.visibility !== 'Hidden' ? h('a', { class: 'btn sm', href: site() + '/v/' + v.id, target: '_blank', rel: 'noopener' }, 'Watch ↗') : null,
          f && f.status === 'ready' && d.visibility === 'Hidden' ? h('a', { class: 'btn sm', href: site() + '/v/' + v.id, target: '_blank', rel: 'noopener', title: 'Only your production team can open it' }, 'Preview ↗') : null,
          can ? h('button', { class: 'sm danger', onclick: async () => { if (!(await confirmBox(`Delete "${d.title}"? The video file is deleted from the server for good.`))) return; try { await App.remove('vodvideo', v.id); paint(); } catch (e) { oops(e); } } }, 'Delete') : null));
    };
    const order = (a, b) => (Number(a.data.season) || 0) - (Number(b.data.season) || 0) || (Number(a.data.episode) || 0) - (Number(b.data.episode) || 0) || String(a.data.title).localeCompare(String(b.data.title));
    const seriesCard = (s) => {
      const eps = App.list('vodvideo').filter((v) => v.data.series === s.id).sort(order);
      const seasons = [...new Set(eps.map((v) => Number(v.data.season) || 1))];
      const p = App.img(s.data.poster) || App.img(s.data.banner) || (eps[0] && posterOf(eps[0], fileOf(eps[0]))) || '';
      return h('div', { class: 'card' },
        h('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start', flexWrap: 'nowrap' } },
          h('div', { class: 'vod-thumb', style: { width: '180px', flex: 'none', backgroundImage: p ? `url("${p}")` : '' } }),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('h2', { style: { margin: '0 0 4px' } }, s.data.title),
            h('div', { class: 'dim small' }, [App.title('channel', s.data.channel), `${eps.length} episode${eps.length === 1 ? '' : 's'}`, seasons.length > 1 ? seasons.length + ' seasons' : '', Number(s.data.price) > 0 ? 'Series R ' + s.data.price : 'Free', s.data.visibility && s.data.visibility !== 'Public' ? s.data.visibility : ''].filter(Boolean).join(' · ')),
            s.data.description ? h('p', { class: 'small', style: { margin: '6px 0 0' } }, s.data.description.slice(0, 240)) : null,
            h('div', { class: 'row', style: { gap: '6px', marginTop: '10px' } },
              can ? h('button', { class: 'sm primary', onclick: () => picker({ series: s.id, channel: s.data.channel, season: seasons.length ? Math.max(...seasons) : 1 }) }, '+ Upload episodes') : null,
              can ? h('a', { class: 'btn sm', href: '#/edit/vodseries/' + s.id }, 'Edit series') : null,
              eps.length ? h('a', { class: 'btn sm', href: site() + '/s/' + s.id, target: '_blank', rel: 'noopener' }, 'Series page ↗') : null,
              can && !eps.length ? h('button', { class: 'sm danger', onclick: async () => { if (await confirmBox(`Delete the series "${s.data.title}"?`)) { await App.remove('vodseries', s.id).catch(oops); paint(); } } }, 'Delete') : null))),
        eps.length ? h('table', { class: 't', style: { marginTop: '12px' } }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Episode'), h('th', {}, 'Length'), h('th', {}, ''), h('th', {}, '')),
          eps.map((v) => { const f = fileOf(v); return h('tr', {}, h('td', { class: 'nowrap dim' }, ep(v.data) || '–'), h('td', {}, v.data.title, v.data.freeInSeries ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'free') : null),
            h('td', { class: 'nowrap' }, dur(f && f.duration)), h('td', {}, state(f)), h('td', { class: 'nowrap' }, can ? h('a', { href: '#/edit/vodvideo/' + v.id }, 'Edit') : null)); })) : h('p', { class: 'dim', style: { marginBottom: 0 } }, 'No episodes yet. Upload them here, or set the series on a video.'));
    };
    const paint = async () => {
      if (!body.isConnected && timer) { clearInterval(timer); return; }
      if (!(await load())) return;
      paintUploads();
      const vids = App.list('vodvideo').filter((v) => !filter || (filter === '-' ? !v.data.series : v.data.series === filter)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const sers = App.sorted('vodseries');
      const tabs = h('div', { class: 'tabs' }, h('button', { class: tab === 'videos' ? 'on' : '', onclick: () => { location.hash = '#/vod'; } }, `VOD (${App.list('vodvideo').length})`), h('button', { class: tab === 'series' ? 'on' : '', onclick: () => { location.hash = '#/vod/series'; } }, `Series (${sers.length})`));
      body.replaceChildren(tabs,
        !info.ffmpeg ? h('div', { class: 'card small' }, h('span', { class: 'pill warn' }, 'No ffmpeg'), ' The server has no ffmpeg, so videos play as uploaded (upload MP4, H.264) and get no poster frame. Install it on the server with: ', h('code', {}, 'sudo apt install ffmpeg')) : null,
        tab === 'series'
          ? (sers.length ? sers.map(seriesCard) : h('div', { class: 'card empty' }, 'No series yet. A series groups episodes into seasons; viewers can buy the whole series and carry on with the next episode.'))
          : [h('div', { class: 'row', style: { marginBottom: '12px' } }, h('select', { class: 'sel', onchange: (e) => { filter = e.target.value; paint(); } }, h('option', { value: '' }, 'All VOD'), h('option', { value: '-', selected: filter === '-' }, 'Not in a series'), sers.map((s) => h('option', { value: s.id, selected: filter === s.id }, s.data.title)))),
            vids.length ? h('div', { class: 'vod-grid' }, vids.map(videoCard)) : h('div', { class: 'card empty' }, 'No VOD yet. Upload films, highlights, interviews or whole shows, or add YouTube videos; sell uploads, or put them in a series.')]);
    };
    repaint = () => { if (upBox.isConnected) paintUploads(); if (!busy()) paint(); };
    paint();
    timer = setInterval(() => { const working = [...files.values()].some((f) => f && ['processing', 'uploading'].includes(f.status)); if (working || busy()) paint(); }, 4000);
    const drop = (e) => { e.preventDefault(); el.classList.remove('drop-over'); if (can && e.dataTransfer.files.length) chooseFiles([...e.dataTransfer.files].filter((f) => /^video\//.test(f.type) || /\.(mkv|mts|m2ts|mxf|ts|mov|mp4)$/i.test(f.name))); };
    const el = h('div', { ondragover: (e) => { e.preventDefault(); el.classList.add('drop-over'); }, ondragleave: () => el.classList.remove('drop-over'), ondrop: drop },
      pageHead('VOD', can ? h('button', { class: 'primary', onclick: () => picker({}) }, '+ Upload VOD') : null, can && App.youtubeImport ? h('button', { onclick: () => App.youtubeImport({}, () => paint()) }, '+ From YouTube') : null, can ? h('button', { onclick: () => App.editModal('vodseries', () => { location.hash = '#/vod/series'; paint(); }, { visibility: 'Public', channel: (App.sorted('channel')[0] || {}).id }) }, '+ New series') : null),
      h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Video on demand for your channels: drop files here or press Upload, or bring in YouTube videos. Big files are fine – they go up in pieces and carry on after a dropped connection. The server makes a web copy that starts at once and a poster frame. Sell a video on its own, a whole series, or let the channel pass cover it.'),
      upBox, body);
    return { el, keepScroll: true, destroy: () => clearInterval(timer) };
  };
})();
