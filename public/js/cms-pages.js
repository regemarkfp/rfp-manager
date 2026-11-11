/* Streaming → Content (the CMS): everything the channels show in one library – VOD uploads, YouTube videos, series,
 * playlists and live streams – with search, filters, categories and tags, and changing many at once; and Website:
 * what the front page (site admins) and each channel page show first and in which order.
 * Streaming → Playlists: playlists of VOD, YouTube videos and live streams (live while on air, then the recording),
 * and bringing in YouTube links and playlists. */
'use strict';
(() => {
  const site = () => location.origin;
  // Content's own tabs: everything the channels show, each part one tap away (the menu has just Content)
  App.contentNav = (on) => h('div', { class: 'tabs content-nav' }, [['library', '#/content', 'Library'], ['streams', '#/streams', 'Live streams'], ['vod', '#/vod', 'VOD'], ['playlists', '#/playlists', 'Playlists'], ['website', '#/content/website', 'Website']]
    .map(([k, href, label]) => h('button', { class: k === on ? 'on' : '', onclick: () => { location.hash = href; } }, h('span', { class: 'cn-ico' }, window.RFPIcons.svg({ library: 'library', streams: 'live', vod: 'movie', playlists: 'playlist', website: 'apps' }[k], 18)), label)));
  const dur = (s) => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return s ? (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0') : ''; };
  const tagsOf = (d) => String(d.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  let files = new Map(), streams = new Map();
  async function loadState() {
    const [a, b] = await Promise.all([api('GET', '/api/vod?team=' + App.team).catch(() => ({ list: [] })), api('GET', '/api/streams?team=' + App.team).catch(() => ({ list: [] }))]);
    files = new Map((a.list || []).map((x) => [x.id, x.file]));
    streams = new Map((b.list || []).filter((x) => !x.parent).map((x) => [x.id, x]));
  }
  // every item of the library in one shape
  function library() {
    const out = [];
    for (const v of App.list('vodvideo')) {
      const d = v.data, f = files.get(v.id), yt = d.source === 'YouTube';
      out.push({ kind: 'vod', type: yt ? 'YouTube' : 'VOD', id: v.id, doc: v, title: d.title, channel: d.channel, category: d.category || '', tags: tagsOf(d), visibility: d.visibility || 'Public', updated: v.updatedAt || 0,
        poster: App.img(d.poster) || d.ytPoster || (f && f.poster ? `/vodfiles/${v.id}/poster.jpg` : ''), length: yt ? d.duration : f && f.duration,
        status: yt ? 'Ready' : !f ? 'No file' : f.status === 'ready' ? 'Ready' : f.status === 'processing' ? `Processing ${f.progress || 0}%` : f.status === 'uploading' ? 'Uploading' : 'Failed',
        sub: d.series ? App.title('vodseries', d.series) + (d.season || d.episode ? ` · S${d.season || 1}${d.episode ? ' E' + d.episode : ''}` : '') : '', open: '/v/' + v.id, edit: '#/edit/vodvideo/' + v.id });
    }
    for (const s of App.list('vodseries')) {
      const n = App.list('vodvideo').filter((v) => v.data.series === s.id).length;
      out.push({ kind: 'series', type: 'Series', id: s.id, doc: s, title: s.data.title, channel: s.data.channel, category: s.data.category || '', tags: tagsOf(s.data), visibility: s.data.visibility || 'Public', updated: s.updatedAt || 0,
        poster: App.img(s.data.poster) || App.img(s.data.banner), status: `${n} episode${n === 1 ? '' : 's'}`, sub: Number(s.data.price) > 0 ? 'R ' + s.data.price : '', open: '/s/' + s.id, edit: '#/edit/vodseries/' + s.id });
    }
    for (const p of App.list('vodplaylist')) {
      const n = (p.data.items || []).length;
      out.push({ kind: 'playlist', type: 'Playlist', id: p.id, doc: p, title: p.data.title, channel: p.data.channel, category: p.data.category || '', tags: tagsOf(p.data), visibility: p.data.visibility || 'Public', updated: p.updatedAt || 0,
        poster: App.img(p.data.poster) || p.data.ytPoster || '', status: `${n} item${n === 1 ? '' : 's'}`, sub: p.data.youtubePlaylist ? 'from YouTube' : '', open: '/p/' + p.id, edit: '#/playlists/' + p.id });
    }
    for (const p of App.list('production')) {
      const d = p.data;
      if (!d.streamSlug || !d.streamChannel) continue;
      const st = streams.get(p.id) || {};
      out.push({ kind: 'live', type: 'Live stream', id: p.id, doc: p, title: d.streamTitle || d.name, channel: d.streamChannel, category: '', tags: [], visibility: d.streamVisibility || 'Channel', updated: p.updatedAt || 0,
        poster: App.img(d.streamPoster), status: st.live ? '● Live' : st.closed ? 'Ended' : (d.date || '') >= UI.today() ? 'Upcoming' : 'Offline', sub: [UI.fmtDate(d.date), d.txTime].filter(Boolean).join(' '), open: '/watch/' + d.streamSlug, edit: '#/edit/production/' + p.id });
    }
    return out;
  }
  const thumbEl = (x, w = 96) => h('div', { class: 'cms-thumb', style: { width: w + 'px', backgroundImage: x.poster ? `url("${x.poster}")` : '' } }, x.length ? h('span', {}, dur(x.length)) : null);
  const typePill = (x) => h('span', { class: 'pill cms-' + x.kind + (x.type === 'YouTube' ? ' cms-yt' : '') }, x.type);

  // ---- picking items (for a playlist, or the featured item)
  function pick(title, { kinds, multi = true, exclude = new Set() } = {}) {
    return new Promise((resolve) => {
      let q = '', type = '';
      const chosen = new Set();
      const all = library().filter((x) => kinds.includes(x.kind) && !exclude.has(x.kind + ':' + x.id) && (x.kind !== 'vod' || x.status === 'Ready'));
      const box = h('div', { class: 'cms-pick' });
      const paint = () => box.replaceChildren(...all.filter((x) => (!type || x.type === type) && (!q || (x.title + ' ' + x.sub + ' ' + x.tags.join(' ')).toLowerCase().includes(q))).sort((a, b) => b.updated - a.updated).slice(0, 200).map((x) =>
        h('label', { class: 'cms-row' + (chosen.has(x) ? ' on' : '') }, h('input', { type: multi ? 'checkbox' : 'radio', name: 'pk', checked: chosen.has(x), onchange: (e) => { if (!multi) chosen.clear(); if (e.target.checked) chosen.add(x); else chosen.delete(x); } }),
          thumbEl(x, 80), h('div', { style: { minWidth: 0 } }, h('b', {}, x.title), h('div', { class: 'dim small' }, [x.type, x.sub, x.status].filter(Boolean).join(' · '))))));
      paint();
      const types = [...new Set(all.map((x) => x.type))];
      modal({ title, wide: true, body: h('div', {}, h('div', { class: 'row', style: { gap: '8px', marginBottom: '8px' } },
        h('input', { type: 'search', placeholder: 'Search titles, series, tags', style: { flex: 1 }, oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } }),
        types.length > 1 ? h('select', { class: 'sel', onchange: (e) => { type = e.target.value; paint(); } }, h('option', { value: '' }, 'Everything'), types.map((t) => h('option', { value: t }, t))) : null), box,
        all.length ? null : h('p', { class: 'dim' }, 'Nothing to add yet. Upload VOD, bring in YouTube videos or set up a live stream first.')),
      actions: [{ label: 'Cancel', onClick: () => resolve([]) }, { label: multi ? 'Add' : 'Choose', primary: true, onClick: () => resolve([...chosen]) }] });
    });
  }
  App.cmsPick = pick;

  // ---- YouTube: links (videos or a playlist) into the library
  App.youtubeImport = async (preset = {}, done) => {
    let hasKey = false;
    try { hasKey = (await api('GET', '/api/yt/key?team=' + App.team)).set; } catch (e) { oops(e); return; }
    const chans = App.sorted('channel');
    if (!chans.length) { toast('Make a channel first (Streaming → Channels)', 'error'); return; }
    const meta = { channel: preset.channel || chans[0].id, visibility: 'Public', series: preset.series || '', makePlaylist: true, category: '' };
    const links = h('textarea', { rows: 4, placeholder: 'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://www.youtube.com/playlist?list=…' });
    const sel = (opts, k) => h('select', { onchange: (e) => { meta[k] = e.target.value; } }, opts.map(([v, t]) => h('option', { value: v, selected: String(meta[k]) === String(v) }, t)));
    const out = h('div', {});
    modal({ title: 'Add from YouTube', wide: true, body: h('div', { class: 'stack' },
      h('p', { class: 'dim', style: { marginTop: 0 } }, 'Paste links, one per line: videos, Shorts, live videos or a whole playlist. They play in your own player on the website and in playlists.'),
      links,
      h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, 'Channel'), sel(chans.map((c) => [c.id, c.data.name]), 'channel')),
        h('label', { class: 'f' }, h('span', {}, 'Who sees them'), sel([['Public', 'Public'], ['Unlisted', 'Unlisted (link only)'], ['Hidden', 'Hidden (only us)']], 'visibility')),
        h('label', { class: 'f' }, h('span', {}, 'Series (optional)'), sel([['', '— not in a series —'], ...App.sorted('vodseries').map((s) => [s.id, s.data.title])], 'series')),
        h('label', { class: 'f' }, h('span', {}, 'Category (optional)'), h('input', { list: 'cms-cats', oninput: (e) => { meta.category = e.target.value; } }), h('datalist', { id: 'cms-cats' }, categories().map((c) => h('option', { value: c })))),
        h('label', { class: 'f row wide' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { meta.makePlaylist = e.target.checked; } }), h('span', {}, 'A YouTube playlist link also becomes a playlist here (sync it again later)'))),
      hasKey ? h('p', { class: 'help' }, '✓ Your YouTube key is set: videos get their length and description, and playlists come in whole.')
        : h('p', { class: 'help' }, 'Single videos work as they are. For whole playlists (and video lengths) an Admin adds a free YouTube Data API key: Content → YouTube key.'), out),
    actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: async () => {
      const r = await api('POST', '/api/yt/import?team=' + App.team, { links: links.value, ...meta });
      for (const d of [...r.videos, ...r.playlists]) App.docs.set(d.id, d);
      toast(`${r.videos.length} video${r.videos.length === 1 ? '' : 's'} added${r.playlists.length ? ' and ' + r.playlists.length + ' playlist' + (r.playlists.length === 1 ? '' : 's') : ''}${r.skipped.length ? ` · ${r.skipped.length} could not be embedded` : ''}`);
      if (done) done(r);
    } }] });
  };
  function categories() { return [...new Set(['vodvideo', 'vodseries', 'vodplaylist'].flatMap((t) => App.list(t).map((d) => d.data.category)).filter(Boolean))].sort(); }
  async function youtubeKey() {
    let cur = false;
    try { cur = (await api('GET', '/api/yt/key?team=' + App.team)).set; } catch (e) { /* not allowed */ }
    const inp = h('input', { type: 'password', placeholder: cur ? 'A key is set – type a new one to change it' : 'AIza…', autocomplete: 'off' });
    modal({ title: 'YouTube key', body: h('div', {}, h('p', { class: 'dim', style: { marginTop: 0 } }, 'A YouTube Data API key lets playlists come in whole, with each video\'s length and description. It is free: Google Cloud console → APIs & Services → enable "YouTube Data API v3" → Credentials → Create API key (restrict it to that API).'), inp,
      h('p', { class: 'help' }, 'Kept on the server only; nobody sees it again here. Empty and Save removes it.')),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { const r = await api('PUT', '/api/yt/key?team=' + App.team, { key: inp.value }); toast(r.set ? 'YouTube key saved' : 'YouTube key removed'); } }] });
  }

  // ---- Streaming → Content
  const sel = (value, opts, on) => h('select', { class: 'sel', onchange: (e) => on(e.target.value) }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  App.pages.content = (tab) => {
    tab = tab === 'website' ? 'website' : 'library';
    const body = h('div', { 'data-nosubnav': '' }, h('div', { class: 'card dim' }, 'Loading…'));
    const can = App.canEdit('vodvideo');
    const F = App.contentFilter || (App.contentFilter = { q: '', type: '', channel: '', category: '', tag: '', visibility: '' });
    const selected = new Set();
    const tabs = () => App.contentNav(tab);
    const paintLibrary = () => {
      const all = library();
      const list = all.filter((x) => (!F.type || x.type === F.type) && (!F.channel || x.channel === F.channel) && (!F.category || x.category === F.category) && (!F.tag || x.tags.includes(F.tag)) && (!F.visibility || x.visibility === F.visibility)
        && (!F.q || (x.title + ' ' + x.sub + ' ' + x.tags.join(' ') + ' ' + x.category).toLowerCase().includes(F.q.toLowerCase()))).sort((a, b) => b.updated - a.updated);
      const tags = [...new Set(all.flatMap((x) => x.tags))].sort();
      const sels = () => list.filter((x) => selected.has(x.kind + ':' + x.id));
      const bulk = h('div', { class: 'bulk-bar', style: { display: 'none' } });
      const paintBulk = () => {
        const s = sels();
        bulk.style.display = s.length ? '' : 'none';
        const editable = s.filter((x) => x.kind !== 'live');
        bulk.replaceChildren(h('b', {}, `${s.length} selected`),
          editable.length ? sel('', [['', 'Who sees it…'], ['Public', 'Public'], ['Unlisted', 'Unlisted'], ['Hidden', 'Hidden']], (v) => v && change(editable, (d) => ({ ...d, visibility: v }), 'Visibility changed')) : null,
          editable.length ? h('button', { class: 'sm', onclick: async () => { const v = await promptBox('Category', 'Category (empty = none)', ''); if (v !== null) change(editable, (d) => ({ ...d, category: v.trim() }), 'Category set'); } }, 'Category') : null,
          editable.length ? h('button', { class: 'sm', onclick: async () => { const v = await promptBox('Add a tag', 'Tag', ''); if (v && v.trim()) change(editable, (d) => ({ ...d, tags: [...new Set([...tagsOf(d), v.trim()])].join(', ') }), 'Tag added'); } }, '+ Tag') : null,
          editable.length && tags.length ? sel('', [['', '− Tag…'], ...tags.map((t) => [t, t])], (v) => v && change(editable, (d) => ({ ...d, tags: tagsOf(d).filter((t) => t !== v).join(', ') }), 'Tag removed')) : null,
          editable.length ? h('button', { class: 'sm', onclick: async () => { const v = await promptBox('Publish on', 'Date (YYYY-MM-DD, empty = now)', ''); if (v !== null) { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return toast('Type the date as 2026-12-01', 'error'); change(editable, (d) => ({ ...d, publishOn: v.trim() }), 'Publish date set'); } } }, 'Publish on') : null,
          s.some((x) => x.kind === 'vod' || x.kind === 'live') ? h('button', { class: 'sm', onclick: () => toPlaylist(s.filter((x) => x.kind === 'vod' || x.kind === 'live')) }, 'Add to playlist') : null,
          editable.length ? h('button', { class: 'sm danger', onclick: async () => {
            if (!(await confirmBox(`Delete ${editable.length} item${editable.length === 1 ? '' : 's'}? Uploaded video files are deleted from the server for good. (Live streams are not deleted here.)`))) return;
            for (const x of editable) await App.remove({ vod: 'vodvideo', series: 'vodseries', playlist: 'vodplaylist' }[x.kind], x.id).catch(oops);
            selected.clear(); paint();
          } }, 'Delete') : null,
          h('button', { class: 'sm ghost', onclick: () => { selected.clear(); paint(); } }, 'Clear'));
      };
      const opt = (arr) => arr.map((v) => [v, v]);
      const filters = h('div', { class: 'row cms-filters' },
        h('input', { type: 'search', placeholder: 'Search the library', value: F.q, style: { flex: '1 1 220px' }, oninput: UI.debounce((e) => { F.q = e.target.value; paint(); }, 250) }),
        sel(F.type, [['', 'All types'], ...opt([...new Set(all.map((x) => x.type))])], (v) => { F.type = v; paint(); }),
        sel(F.channel, [['', 'All channels'], ...App.sorted('channel').map((c) => [c.id, c.data.name])], (v) => { F.channel = v; paint(); }),
        sel(F.category, [['', 'All categories'], ...opt(categories())], (v) => { F.category = v; paint(); }),
        tags.length ? sel(F.tag, [['', 'All tags'], ...opt(tags)], (v) => { F.tag = v; paint(); }) : null,
        sel(F.visibility, [['', 'Anyone'], ...opt(['Public', 'Unlisted', 'Hidden'])], (v) => { F.visibility = v; paint(); }));
      const allBox = h('input', { type: 'checkbox', onchange: (e) => { for (const x of list) { if (e.target.checked) selected.add(x.kind + ':' + x.id); else selected.delete(x.kind + ':' + x.id); } paint(); } });
      allBox.checked = list.length > 0 && list.every((x) => selected.has(x.kind + ':' + x.id));
      const rows = list.map((x) => h('tr', { class: selected.has(x.kind + ':' + x.id) ? 'sel' : '' },
        h('td', {}, can ? h('input', { type: 'checkbox', checked: selected.has(x.kind + ':' + x.id), onchange: (e) => { if (e.target.checked) selected.add(x.kind + ':' + x.id); else selected.delete(x.kind + ':' + x.id); e.target.closest('tr').classList.toggle('sel', e.target.checked); allBox.checked = list.every((y) => selected.has(y.kind + ':' + y.id)); paintBulk(); } }) : null),
        h('td', {}, thumbEl(x)),
        h('td', {}, h('a', { href: x.edit }, h('b', {}, x.title)), h('div', { class: 'dim small' }, [x.sub, App.title('channel', x.channel)].filter(Boolean).join(' · ')), x.tags.length ? h('div', {}, x.tags.map((t) => h('span', { class: 'pill', style: { marginRight: '4px' } }, t))) : null),
        h('td', {}, typePill(x)), h('td', { class: 'small' }, x.category), h('td', { class: 'small' }, x.visibility),
        h('td', { class: 'small nowrap' }, h('span', { class: 'pill' + (/Live/.test(x.status) ? ' live' : /Failed|No file/.test(x.status) ? ' warn' : x.status === 'Ready' ? ' ok' : '') }, x.status)),
        h('td', { class: 'small nowrap dim' }, x.updated ? new Date(x.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''),
        h('td', { class: 'nowrap' }, h('a', { class: 'btn sm', href: x.edit }, 'Edit'), ' ', x.kind === 'vod' && can ? [h('button', { class: 'sm', title: 'Subtitles', onclick: () => App.vodSubtitles(x.id) }, 'CC'), ' '] : null, h('a', { class: 'btn sm', href: site() + x.open, target: '_blank', rel: 'noopener' }, '↗'))));
      body.replaceChildren(tabs(), filters, bulk,
        list.length ? h('div', { class: 'card', style: { padding: '0' } }, h('div', { class: 'tablewrap' }, h('table', { class: 't cms-table' }, h('tr', {}, h('th', {}, can ? allBox : ''), h('th', {}, ''), h('th', {}, `Title (${list.length})`), h('th', {}, 'Type'), h('th', {}, 'Category'), h('th', {}, 'Who sees it'), h('th', {}, 'Status'), h('th', {}, 'Changed'), h('th', {}, '')), rows)))
          : h('div', { class: 'card empty' }, all.length ? 'Nothing matches these filters.' : 'The library is empty. Upload VOD, add YouTube videos, make a series or a playlist, or set up a live stream.'));
      paintBulk();
    };
    async function change(items, fn, msg) {
      let n = 0;
      for (const x of items) { try { await App.save(x.doc.type, x.id, fn({ ...x.doc.data })); n++; } catch (e) { oops(e); break; } }
      toast(`${msg} (${n})`); paint();
    }
    async function toPlaylist(items) {
      const pls = App.sorted('vodplaylist');
      const choice = { id: pls[0] ? pls[0].id : '' };
      modal({ title: `Add ${items.length} to a playlist`, body: h('div', {}, pls.length ? sel(choice.id, pls.map((p) => [p.id, p.data.title]), (v) => { choice.id = v; }) : h('p', { class: 'dim' }, 'No playlists yet: a new one is made.'),
        h('p', { class: 'help' }, 'Live streams play live while on air, then their recording.')),
      actions: [{ label: 'Cancel' }, pls.length ? { label: 'New playlist', onClick: async () => { await newPlaylist(items); } } : null, { label: pls.length ? 'Add' : 'Make it', primary: true, onClick: async () => {
        if (!pls.length) return newPlaylist(items);
        const p = App.docs.get(choice.id);
        const have = new Set((p.data.items || []).map((x) => x.kind + ':' + x.id));
        await App.save('vodplaylist', p.id, { ...p.data, items: [...(p.data.items || []), ...items.filter((x) => !have.has(x.kind + ':' + x.id)).map((x) => ({ kind: x.kind, id: x.id }))] });
        toast('Added to ' + p.data.title); paint();
      } }].filter(Boolean) });
    }
    async function newPlaylist(items) {
      const t = await promptBox('New playlist', 'Title', '');
      if (!t) return;
      const ch = (items.find((x) => x.channel) || {}).channel || (App.sorted('channel')[0] || {}).id;
      const doc = await App.save('vodplaylist', App.newId('vodplaylist'), { title: t, channel: ch, visibility: 'Public', items: items.map((x) => ({ kind: x.kind, id: x.id })) });
      toast('Playlist made'); location.hash = '#/playlists/' + doc.id;
    }

    // ---- Website: the featured item and the rows of the front page / a channel page
    let target = App.contentTarget || (App.machine && App.machine.siteAdmin ? 'site' : (App.sorted('channel')[0] || {}).id || '');
    const BUILT = { live: 'Live now', liveMatches: 'Live matches', upcoming: 'Coming up', videos: 'Latest videos', series: 'Series', playlists: 'Playlists', fixtures: 'Fixtures', results: 'Results', channels: 'Channels' };
    const CH_ROWS = ['live', 'upcoming', 'videos', 'series', 'playlists'];
    const DEFAULT = (isSite) => ({ hero: { mode: 'auto', item: null }, rows: (isSite ? ['live', 'liveMatches', 'upcoming', 'videos', 'series', 'playlists', 'fixtures', 'results', 'channels'] : ['live', 'upcoming', 'series', 'playlists', 'videos']).map((key) => ({ type: 'builtin', key, title: '' })) });
    const rowName = (r) => (r.type === 'builtin' ? BUILT[r.key] + ' (automatic)' : r.type === 'playlist' ? 'Playlist: ' + App.title('vodplaylist', r.id) : r.type === 'series' ? 'Series: ' + App.title('vodseries', r.id) : 'Category: ' + r.name);
    async function paintWebsite() {
      const isSite = target === 'site';
      const ch = isSite ? null : App.docs.get(target);
      let layout = null;
      try { layout = isSite ? (await api('GET', '/api/site/layout')).layout : ch && ch.data.layout; } catch (e) { body.replaceChildren(tabs(), h('div', { class: 'card' }, e.message)); return; }
      let L = JSON.parse(JSON.stringify(layout || DEFAULT(isSite)));
      const custom = !!layout;
      const targets = [...(App.machine && App.machine.siteAdmin ? [['site', 'The website\'s front page']] : []), ...App.sorted('channel').map((c) => [c.id, 'Channel: ' + c.data.name])];
      const box = h('div', {});
      const heroItem = () => { const it = L.hero.item; if (!it) return 'Nothing chosen'; const x = library().find((y) => y.kind === it.kind && y.id === it.id); return x ? `${x.type}: ${x.title}` : 'Not there any more'; };
      const paintL = () => box.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'Featured at the top'),
          h('div', { class: 'row' }, sel(L.hero.mode, [['auto', isSite ? 'Automatic: the live stream when something is live' : 'Nothing (the rows only)'], ['pick', 'Always this item'], ['none', 'Nothing']].filter((o) => isSite || o[0] !== 'none'), (v) => { L.hero.mode = v; paintL(); }),
            L.hero.mode === 'pick' ? [h('b', {}, heroItem()), h('button', { class: 'sm', onclick: async () => { const [x] = await pick('Featured item', { kinds: ['vod', 'series', 'playlist', 'live'], multi: false }); if (x) { L.hero.item = { kind: x.kind, id: x.id }; paintL(); } } }, 'Choose…')] : null)),
        h('div', { class: 'card' }, h('h2', {}, 'Rows, top to bottom'),
          L.rows.length ? h('div', { class: 'cms-rows' }, L.rows.map((r, i) => h('div', { class: 'cms-lrow' },
            h('span', { class: 'dim', style: { width: '22px' } }, String(i + 1)), h('b', { style: { flex: 1 } }, rowName(r)),
            h('input', { placeholder: 'Heading (empty = as named)', value: r.title || '', style: { width: '220px' }, oninput: (e) => { r.title = e.target.value; } }),
            h('button', { class: 'sm', disabled: i === 0, onclick: () => { L.rows.splice(i - 1, 0, L.rows.splice(i, 1)[0]); paintL(); } }, '↑'),
            h('button', { class: 'sm', disabled: i === L.rows.length - 1, onclick: () => { L.rows.splice(i + 1, 0, L.rows.splice(i, 1)[0]); paintL(); } }, '↓'),
            h('button', { class: 'sm danger', onclick: () => { L.rows.splice(i, 1); paintL(); } }, '✕')))) : h('p', { class: 'dim' }, 'No rows.'),
          h('div', { class: 'row', style: { marginTop: '10px' } }, sel('', [['', '+ Add a row…'],
            ...Object.keys(BUILT).filter((k) => (isSite || CH_ROWS.includes(k)) && !L.rows.some((r) => r.type === 'builtin' && r.key === k)).map((k) => ['b:' + k, BUILT[k] + ' (automatic)']),
            ...App.sorted('vodplaylist').filter((p) => isSite || p.data.channel === target).map((p) => ['p:' + p.id, 'Playlist: ' + p.data.title]),
            ...App.sorted('vodseries').filter((s) => isSite || s.data.channel === target).map((s) => ['s:' + s.id, 'Series: ' + s.data.title]),
            ...categories().map((c) => ['c:' + c, 'Category: ' + c])], (v) => {
            if (!v) return;
            const [k, id] = [v.slice(0, 1), v.slice(2)];
            L.rows.push(k === 'b' ? { type: 'builtin', key: id, title: '' } : k === 'p' ? { type: 'playlist', id, title: '' } : k === 's' ? { type: 'series', id, title: '' } : { type: 'category', name: id, title: '' });
            paintL();
          }))),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, 'Save'), custom ? h('button', { onclick: () => save(true) }, 'Back to the automatic page') : h('span', { class: 'dim small' }, 'Now automatic: saving makes it yours.'),
          h('a', { class: 'btn', href: site() + (isSite ? '/' : '/c/' + (ch ? ch.data.slug : '')), target: '_blank', rel: 'noopener' }, 'Open the page ↗')));
      async function save(reset) {
        try {
          if (isSite) await api('PUT', '/api/site/layout', { layout: reset === true ? null : L });
          else await App.save('channel', ch.id, { ...ch.data, layout: reset === true ? null : L });
          toast(reset === true ? 'Back to automatic' : 'Saved – the page shows it within seconds');
          paintWebsite();
        } catch (e) { oops(e); }
      }
      paintL();
      body.replaceChildren(tabs(), h('div', { class: 'row', style: { marginBottom: '12px' } }, sel(target, targets, (v) => { target = App.contentTarget = v; paintWebsite(); })),
        h('p', { class: 'dim', style: { marginTop: 0 } }, isSite ? 'The front page of the website: what is featured, and the rows in your order. Automatic rows fill themselves; playlist, series and category rows show what you put in them.' : 'This channel\'s Home tab. Its Videos, Series and Playlists tabs still list everything.'), box);
    }
    const paint = async () => {
      if (tab === 'website') return paintWebsite();
      await loadState();
      paintLibrary();
    };
    paint();
    const admin = App.can('admin');
    return { el: h('div', {}, pageHead('Content',
      can ? h('button', { class: 'primary', onclick: () => { location.hash = '#/vod'; } }, '+ Upload VOD') : null,
      can ? h('button', { onclick: () => App.youtubeImport({}, () => paint()) }, '+ From YouTube') : null,
      can ? h('button', { onclick: () => App.editModal('vodplaylist', (d) => { location.hash = '#/playlists/' + d.id; }, { visibility: 'Public', channel: (App.sorted('channel')[0] || {}).id, items: [] }) }, '+ Playlist') : null,
      admin ? h('button', { class: 'ghost', onclick: youtubeKey }, 'YouTube key') : null),
    h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Everything your channels show, in one place: VOD, YouTube videos, series, playlists and live streams. Tick several to change them together; Website arranges the front page and channel pages.'), body), keepScroll: true };
  };

  // ---- Streaming → Playlists
  App.pages.playlists = (id) => (id ? playlistEditor(id) : playlistList());
  function playlistList() {
    const body = h('div', { 'data-nosubnav': '' }, h('div', { class: 'card dim' }, 'Loading…'));
    const can = App.canEdit('vodplaylist');
    const paint = async () => {
      await loadState();
      const lib = library();
      const pls = App.list('vodplaylist').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      body.replaceChildren(pls.length ? h('div', { class: 'vod-grid' }, pls.map((p) => {
        const items = (p.data.items || []).map((x) => lib.find((y) => y.kind === x.kind && y.id === x.id)).filter(Boolean);
        const poster = App.img(p.data.poster) || p.data.ytPoster || (items[0] && items[0].poster) || '';
        return h('div', { class: 'card vod-card' }, h('a', { href: '#/playlists/' + p.id, class: 'vod-thumb', style: { backgroundImage: poster ? `url("${poster}")` : '' } }, h('span', { class: 'vod-dur' }, `▤ ${items.length}`), items.some((x) => /Live/.test(x.status)) ? h('span', { class: 'vod-state' }, h('span', { class: 'pill live' }, '● LIVE')) : null),
          h('div', {}, h('b', {}, p.data.title), h('div', { class: 'dim small' }, [App.title('channel', p.data.channel), p.data.visibility !== 'Public' ? p.data.visibility : '', p.data.youtubePlaylist ? 'from YouTube' : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'row', style: { gap: '6px', marginTop: 'auto' } }, h('a', { class: 'btn sm', href: '#/playlists/' + p.id }, can ? 'Edit' : 'Open'), h('a', { class: 'btn sm', href: site() + '/p/' + p.id, target: '_blank', rel: 'noopener' }, 'Play ↗')));
      })) : h('div', { class: 'card empty' }, 'No playlists yet. A playlist plays VOD, YouTube videos and live streams one after the other; put one on the website as a row (Content → Website).'));
    };
    paint();
    return { el: h('div', {}, pageHead('Playlists', can ? h('button', { class: 'primary', onclick: () => App.editModal('vodplaylist', (d) => { location.hash = '#/playlists/' + d.id; }, { visibility: 'Public', channel: (App.sorted('channel')[0] || {}).id, items: [] }) }, '+ New playlist') : null,
      can ? h('button', { onclick: () => App.youtubeImport({}, (r) => { if (r.playlists[0]) location.hash = '#/playlists/' + r.playlists[0].id; else paint(); }) }, '+ From YouTube') : null), App.contentNav('playlists'), body) };
  }
  function playlistEditor(id) {
    const body = h('div', { 'data-nosubnav': '' }, h('div', { class: 'card dim' }, 'Loading…'));
    const can = App.canEdit('vodplaylist');
    let dragFrom = -1;
    const paint = async () => {
      await loadState();
      const p = App.docs.get(id);
      if (!p) { body.replaceChildren(h('div', { class: 'card' }, 'This playlist is not there any more. ', h('a', { href: '#/playlists' }, 'All playlists'))); return; }
      const lib = library();
      const items = (p.data.items || []).map((x) => ({ ref: x, it: lib.find((y) => y.kind === x.kind && y.id === x.id) }));
      const setItems = async (list, msg) => { try { await App.save('vodplaylist', id, { ...App.docs.get(id).data, items: list }); if (msg) toast(msg); paint(); } catch (e) { oops(e); } };
      const move = (from, to) => { const list = items.map((x) => x.ref); list.splice(to, 0, list.splice(from, 1)[0]); setItems(list); };
      const total = items.reduce((n, x) => n + ((x.it && x.it.length) || 0), 0);
      body.replaceChildren(
        h('div', { class: 'card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          h('div', {}, h('h2', { style: { margin: 0 } }, p.data.title), h('div', { class: 'dim small' }, [App.title('channel', p.data.channel), `${items.length} item${items.length === 1 ? '' : 's'}`, total ? dur(total) : '', p.data.visibility, p.data.youtubePlaylist ? 'from YouTube' + (p.data.syncedAt ? ', synced ' + new Date(p.data.syncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '') : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'row', style: { gap: '6px' } },
            can ? h('button', { class: 'primary', onclick: async () => { const add = await pick('Add to ' + p.data.title, { kinds: ['vod', 'live'], exclude: new Set(items.map((x) => x.ref.kind + ':' + x.ref.id)) }); if (add.length) setItems([...items.map((x) => x.ref), ...add.map((x) => ({ kind: x.kind, id: x.id }))], `${add.length} added`); } }, '+ Add items') : null,
            can && p.data.youtubePlaylist ? h('button', { onclick: async (e) => { e.target.disabled = true; try { const r = await api('POST', `/api/yt/sync/${id}?team=${App.team}`); App.docs.set(r.doc.id, r.doc); toast(`Synced with YouTube (${r.added} videos)`); paint(); } catch (er) { oops(er); e.target.disabled = false; } } }, '↻ Sync with YouTube') : null,
            can ? h('a', { class: 'btn', href: '#/edit/vodplaylist/' + id }, 'Details') : null,
            h('a', { class: 'btn', href: site() + '/p/' + id, target: '_blank', rel: 'noopener' }, 'Play ↗')))),
        items.length ? h('div', { class: 'card', style: { padding: '6px' } }, items.map(({ ref, it }, i) => h('div', { class: 'cms-lrow pl-row', draggable: can ? 'true' : null,
          ondragstart: () => { dragFrom = i; }, ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i); dragFrom = -1; } },
          h('span', { class: 'dim', style: { width: '24px', textAlign: 'right' } }, can ? '⋮⋮' : String(i + 1)),
          it ? thumbEl(it, 120) : h('div', { class: 'cms-thumb', style: { width: '120px' } }),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, it ? it.title : 'Not there any more'), h('div', { class: 'dim small' }, it ? [it.type, it.sub, it.status].filter(Boolean).join(' · ') : ref.kind)),
          can ? [h('button', { class: 'sm', disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'), h('button', { class: 'sm', disabled: i === items.length - 1, onclick: () => move(i, i + 1) }, '↓'),
            h('button', { class: 'sm danger', onclick: () => setItems(items.filter((_, j) => j !== i).map((x) => x.ref)) }, '✕')] : null)))
          : h('div', { class: 'card empty' }, 'Empty. Add VOD, YouTube videos or live streams; drag to put them in order.'),
        h('p', { class: 'dim small' }, 'Live streams in a playlist play live while they are on air, show when they start before that, and play their recording afterwards.'));
    };
    paint();
    return { el: h('div', {}, pageHead(h('span', {}, h('a', { href: '#/playlists' }, 'Playlists'), ' › ', App.title('vodplaylist', id))), App.contentNav('playlists'), body), keepScroll: true };
  }
})();

// ---- subtitles of a VOD (uploads and YouTube): .srt or .vtt files per language; viewers pick them in the player (CC)
(() => {
  const LANGS = [['en', 'English'], ['af', 'Afrikaans'], ['zu', 'isiZulu'], ['xh', 'isiXhosa'], ['st', 'Sesotho'], ['tn', 'Setswana'], ['nso', 'Sepedi'], ['ts', 'Xitsonga'], ['ss', 'siSwati'], ['ve', 'Tshivenda'], ['nr', 'isiNdebele'],
    ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['nl', 'Dutch'], ['sw', 'Kiswahili'], ['zh', 'Chinese'], ['ar', 'Arabic'], ['hi', 'Hindi']];
  App.vodSubtitles = async (id, done) => {
    const v = App.docs.get(id);
    const box = h('div', {});
    const can = App.canEdit('vodvideo');
    const paint = async () => {
      let list = [];
      try { list = (await api('GET', `/api/vod/${id}/subtitles?team=${App.team}`)).list; } catch (e) { box.replaceChildren(h('p', {}, e.message)); return; }
      const lang = h('select', {}, LANGS.map(([c, n]) => h('option', { value: c }, n)), h('option', { value: '' }, 'Other / none'));
      const label = h('input', { placeholder: 'Name shown to viewers (empty = the language)' });
      const def = h('input', { type: 'checkbox' });
      const file = h('input', { type: 'file', accept: '.srt,.vtt,text/vtt' });
      const up = h('button', { class: 'primary', onclick: async () => {
        const f = file.files[0];
        if (!f) return toast('Choose a .srt or .vtt file', 'error');
        if (f.size > 2 * 1024 * 1024) return toast('Subtitle files can be up to 2 MB', 'error');
        up.disabled = true;
        try {
          const name = label.value.trim() || (LANGS.find(([c]) => c === lang.value) || [, 'Subtitles'])[1];
          await api('POST', `/api/vod/${id}/subtitles?team=${App.team}&lang=${encodeURIComponent(lang.value)}&label=${encodeURIComponent(name)}&default=${def.checked ? 1 : 0}`, f, { 'content-type': 'text/plain' });
          toast('Subtitles added'); paint(); if (done) done();
        } catch (e) { oops(e); up.disabled = false; }
      } }, 'Upload');
      box.replaceChildren(
        list.length ? h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Language'), h('th', {}, 'Lines'), h('th', {}, 'Default'), h('th', {}, '')),
          list.map((x) => h('tr', {}, h('td', {}, x.label), h('td', {}, (LANGS.find(([c]) => c === x.lang) || [x.lang, x.lang || '–'])[1]), h('td', {}, String(x.cues || '')),
            h('td', {}, can ? h('input', { type: 'checkbox', checked: !!x.default, title: 'Shown when a viewer has not chosen yet', onchange: async (e) => { try { await api('PUT', `/api/vod/${id}/subtitles/${x.id}?team=${App.team}`, { default: e.target.checked }); paint(); } catch (er) { oops(er); } } }) : (x.default ? '✓' : '')),
            h('td', {}, can ? h('button', { class: 'sm danger', onclick: async () => { if (await confirmBox(`Delete the ${x.label} subtitles?`)) { await api('DELETE', `/api/vod/${id}/subtitles/${x.id}?team=${App.team}`).catch(oops); paint(); if (done) done(); } } }, 'Delete') : null))))
          : h('p', { class: 'dim', style: { marginTop: 0 } }, 'No subtitles yet.'),
        can ? h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', { style: { marginTop: 0 } }, 'Add subtitles'),
          h('div', { class: 'form' }, h('label', { class: 'f' }, h('span', {}, 'Language'), lang), h('label', { class: 'f' }, h('span', {}, 'Name'), label),
            h('label', { class: 'f wide' }, h('span', {}, 'File (.srt or .vtt)'), file), h('label', { class: 'f row wide' }, def, h('span', {}, 'Show these unless the viewer chooses otherwise'))),
          h('div', { style: { marginTop: '10px' } }, up),
          h('p', { class: 'help' }, 'Viewers turn subtitles on and choose the language, size, colour and background under CC in the player. They show over uploaded VOD and YouTube videos alike.')) : null);
    };
    paint();
    modal({ title: 'Subtitles · ' + (v ? v.data.title : ''), wide: true, body: box, actions: [{ label: 'Close' }] });
  };
})();
