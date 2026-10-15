/* Master control (MCR) for a live stream, in the Studio: slates, ad breaks with video adverts, graphics over the
 * picture and a schedule of cues. All of it happens in the viewers' players (the website's app), so the feed and its
 * recording stay clean. Also the ad-break countdown banner across the Studio. */
'use strict';
(() => {
  const dur = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const h2 = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h2 ? h2 + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const KINDS = [['technical', 'Technical difficulties'], ['connection', 'Connection issues'], ['weather', 'Weather delay'], ['break', 'Right back'], ['starting', 'Starting soon'], ['countdown', 'Countdown…'], ['custom', 'Custom…']];
  const OVL = [['bug', 'Logo bug', 'A small logo or word in a corner (LIVE, REPLAY, your logo)'], ['lower', 'Lower third', 'A name or message across the bottom'], ['ticker', 'Ticker', 'Scrolling text along the bottom'], ['image', 'Image', 'A sponsor board or graphic in a corner']];
  const POS = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
  const local = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  // the status line of a stream: what the viewers see now
  function statusText(sum, now) {
    if (!sum) return { cls: 'ok', text: 'Clean: viewers see the live picture' };
    if (sum.ad) return { cls: 'ad', text: `AD BREAK · ${sum.ad.count > 1 ? `ad ${sum.ad.index + 1} of ${sum.ad.count} · ` : ''}back to live in ${dur((Date.parse(sum.ad.endsAt) - now) / 1000)}` };
    if (sum.squeeze) return { cls: 'ad', text: `SQUEEZE-BACK · ${sum.squeeze.count ? sum.squeeze.count + ' advert' + (sum.squeeze.count > 1 ? 's' : '') : 'sponsor board'} · full screen again in ${dur((Date.parse(sum.squeeze.endsAt) - now) / 1000)}` };
    if (sum.slate) return { cls: 'slate', text: `SLATE · ${sum.slate.title}${sum.slate.until ? ' · ends in ' + dur((Date.parse(sum.slate.until) - now) / 1000) : ' · until taken off'}` };
    if (sum.overlays && sum.overlays.length) return { cls: 'ok', text: 'Live picture with ' + sum.overlays.join(', ') };
    return { cls: 'ok', text: 'Clean: viewers see the live picture' };
  }
  App.mcrStatus = statusText;

  // ---- the video advert library: ad-break videos and squeeze-back videos, and the presets
  const libApi = {
    ads: async () => (await api('GET', '/api/videoads?team=' + App.team)).list,
    presets: async () => (await api('GET', '/api/adpresets?team=' + App.team)).list,
  };
  // uploads a video into a list (kind ad | squeeze); progress in `prog`
  function uploadAd(f, kind, prog, done) {
    new Promise((resolve) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { resolve(v.duration || 0); URL.revokeObjectURL(v.src); }; v.onerror = () => resolve(0); v.src = URL.createObjectURL(f); }).then((secs) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/videoads?team=${App.team}&kind=${kind}&name=${encodeURIComponent(f.name)}&duration=${secs || ''}`);
      x.setRequestHeader('x-rfp', '1'); x.setRequestHeader('content-type', f.type || 'video/mp4');
      x.upload.onprogress = (e) => { if (e.lengthComputable) prog.textContent = e.loaded < e.total ? `Uploading ${f.name}: ${Math.round((e.loaded / e.total) * 100)}%` : 'Preparing the video for phones…'; };
      x.onload = () => { prog.textContent = ''; let r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not json */ } if (x.status >= 300) return toast(r.error || 'Upload failed', 'error'); toast('Video added'); done(r.ad); };
      x.onerror = () => { prog.textContent = ''; toast('Upload failed', 'error'); };
      x.send(f);
    });
  }
  const uploadBtn = (kind, label, done) => {
    const prog = h('span', { class: 'dim small' });
    const file = h('input', { type: 'file', accept: kind === 'music' ? 'audio/*,.mp3,.m4a,.wav,.flac' : 'video/mp4,video/quicktime,video/webm', multiple: '', style: { display: 'none' }, onchange: () => { for (const f of file.files) uploadAd(f, kind, prog, done); file.value = ''; } });
    return [h('button', { class: 'sm', onclick: () => file.click() }, label), file, prog];
  };
  // a list of videos with ticks (picked keeps the order) or with edit buttons
  function videoTable(list, { picked, onPick, manage, reload, empty }) {
    if (!list.length) return h('p', { class: 'dim', style: { margin: '0 0 8px' } }, empty || 'No videos here yet. Add MP4 files (H.264 + AAC plays on every phone and browser).');
    return h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, list.map((a) => {
      const n = picked ? picked.indexOf(a.id) : -1;
      return h('tr', {},
        picked ? h('td', { style: { width: '34px' } }, h('input', { type: 'checkbox', checked: n >= 0, onchange: (e) => onPick(a.id, e.target.checked) })) : null,
        picked ? h('td', { style: { width: '28px' } }, n >= 0 ? h('span', { class: 'pill' }, String(n + 1)) : null) : null,
        h('td', {}, h('b', {}, a.title)), h('td', { class: 'nowrap dim' }, dur(a.duration)),
        h('td', { class: 'nowrap', style: { textAlign: 'right' } }, h('a', { class: 'btn sm ghost', href: a.url, target: '_blank', rel: 'noopener' }, 'Preview'),
          manage ? [
            h('button', { class: 'sm ghost', onclick: async () => { const t = await promptBox('Rename', 'Name', a.title); if (!t) return; try { await api('PUT', `/api/videoads/${a.id}?team=${App.team}`, { title: t }); reload(); } catch (e) { oops(e); } } }, 'Rename'),
            a.kind === 'music' ? null : h('button', { class: 'sm ghost', onclick: async () => { try { await api('PUT', `/api/videoads/${a.id}?team=${App.team}`, { kind: a.kind === 'squeeze' ? 'ad' : 'squeeze' }); toast('Moved'); reload(); } catch (e) { oops(e); } } }, a.kind === 'squeeze' ? 'Move to ad breaks' : 'Move to squeeze-backs')] : null,
          App.canEdit('production') ? h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox(`Delete the video "${a.title}"?`))) return; try { await api('DELETE', `/api/videoads/${a.id}?team=${App.team}`); reload(); } catch (e) { oops(e); } } }, '✕') : null));
    }))));
  }
  const presetText = (p, ads) => {
    const names = (p.ads || []).map((x) => (ads.find((a) => a.id === x) || {}).title).filter(Boolean);
    const total = (p.ads || []).reduce((n, x) => n + ((ads.find((a) => a.id === x) || {}).duration || 0), 0);
    return p.kind === 'squeeze' ? `Squeeze-back · ${names.length ? names.length + ' video' + (names.length > 1 ? 's' : '') + ' · ' + dur(total) : 'sponsor board · ' + p.seconds + ' s'} · ${{ tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[p.pos] || 'top right'}`
      : `Ad break · ${names.length} video${names.length === 1 ? '' : 's'} · ${dur(total)}`;
  };
  // the preset editor (a modal)
  function editPreset(p, ads, saved) {
    const d = { kind: 'ads', name: '', ads: [], image: '', seconds: 20, pos: 'tr', sound: 'ad', text: '', ...(p || {}) };
    const body = h('div', {});
    const paint = () => {
      const list = ads.filter((a) => (a.kind || 'ad') === (d.kind === 'squeeze' ? 'squeeze' : 'ad'));
      const sel = (key, opts) => h('select', { style: { width: 'auto' }, onchange: (e) => { d[key] = e.target.value; paint(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(d[key]) === String(v) }, l)));
      body.replaceChildren(
        h('label', { class: 'f' }, h('span', {}, 'Name'), h('input', { value: d.name, placeholder: d.kind === 'squeeze' ? 'Sponsor squeeze-back' : 'Half-time break', oninput: (e) => { d.name = e.target.value; } })),
        h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', margin: '8px 0' } }, h('span', { class: 'small' }, 'What'), sel('kind', [['ads', 'Ad break (full screen)'], ['squeeze', 'Squeeze-back']])),
        h('div', { class: 'dim small' }, d.kind === 'squeeze' ? 'Squeeze-back videos, in order (or none, for just the sponsor board):' : 'Ad break videos, in order:'),
        videoTable(list, { picked: d.ads, onPick: (id, on) => { d.ads = on ? [...d.ads, id] : d.ads.filter((x) => x !== id); paint(); } }),
        d.kind === 'squeeze' ? h('div', { style: { marginTop: '10px' } },
          h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { class: 'small' }, 'Live picture'), sel('pos', POS), h('span', { class: 'small' }, 'Sound'), sel('sound', [['ad', 'The advert'], ['live', 'The live stream']]),
            h('input', { value: d.text, placeholder: 'Text on the board (optional)', style: { width: '220px' }, oninput: (e) => { d.text = e.target.value; } })),
          h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '8px' } },
            h('div', { style: { minWidth: '220px' } }, h('div', { class: 'dim small' }, 'Sponsor board (behind the picture, or on its own)'), typeof imageField === 'function' ? imageField(d.image, (v) => { d.image = v || ''; }, 'sponsor') : null),
            h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'Board on its own for'), h('input', { type: 'number', min: 5, max: 600, value: d.seconds, style: { width: '80px' }, oninput: (e) => { d.seconds = Number(e.target.value) || 20; } }), h('span', { class: 'small' }, 's')))) : null);
    };
    paint();
    UI.modal({ title: p && p.id ? 'Edit preset' : 'New preset', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save preset', primary: true, onClick: async () => {
      const r = await api('PUT', `/api/adpresets/${p && p.id ? p.id : 'new'}?team=${App.team}`, d);
      toast('Preset saved'); saved(r.preset);
    } }] });
  }
  App.editAdPreset = editPreset;

  // ---- Advertising → Stream adverts: the two video lists and the presets
  App.pages.streamads = () => {
    const box = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const paint = async () => {
      let ads = [], presets = [];
      try { [ads, presets] = await Promise.all([libApi.ads(), libApi.presets()]); } catch (e) { box.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const can = App.canEdit('production');
      const lst = (kind) => ads.filter((a) => (a.kind || 'ad') === kind);
      box.replaceChildren(
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Presets'), can ? h('button', { class: 'primary sm', onclick: () => editPreset(null, ads, paint) }, '+ New preset') : null),
          h('p', { class: 'dim', style: { marginTop: '4px' } }, 'Ready-made ad breaks and squeeze-backs: one press in Master control, or set them on a cue or an automatic rule (a try, a wicket …).'),
          presets.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, presets.map((p) => h('tr', {},
            h('td', {}, h('b', {}, p.name)), h('td', { class: 'dim small' }, presetText(p, ads)),
            h('td', { class: 'nowrap', style: { textAlign: 'right' } }, can ? [h('button', { class: 'sm ghost', onclick: () => editPreset(p, ads, paint) }, 'Edit'),
              h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox(`Delete the preset "${p.name}"?`))) return; try { await api('DELETE', `/api/adpresets/${p.id}?team=${App.team}`); paint(); } catch (e) { oops(e); } } }, '✕')] : null)))))) : h('p', { class: 'dim', style: { margin: 0 } }, 'No presets yet.')),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Ad break videos'), can ? h('div', { class: 'row' }, uploadBtn('ad', '+ Add videos', paint)) : null),
          h('p', { class: 'dim', style: { marginTop: '4px' } }, 'Full-screen adverts: viewers in the app see these instead of the live picture.'),
          videoTable(lst('ad'), { manage: can, reload: paint })),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Squeeze-back videos'), can ? h('div', { class: 'row' }, uploadBtn('squeeze', '+ Add videos', paint)) : null),
          h('p', { class: 'dim', style: { marginTop: '4px' } }, 'Played behind the live picture while it is squeezed into a corner: sponsor loops, short spots.'),
          videoTable(lst('squeeze'), { manage: can, reload: paint })),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Slate music'), can ? h('div', { class: 'row' }, uploadBtn('music', '+ Add music', paint)) : null),
          h('p', { class: 'dim', style: { marginTop: '4px' } }, 'Loops under a slate (technical difficulties, weather delay …) instead of the live sound. Choose it per stream in Master control. MP3, M4A, WAV or FLAC; the loudness is levelled.'),
          videoTable(lst('music'), { manage: can, reload: paint, empty: 'No music yet. Add MP3, M4A, WAV or FLAC files.' })));
    };
    paint();
    return { el: h('div', {}, pageHead('Stream adverts'), h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Video adverts and slate music for live streams on the website (Master control). Only viewers in the app see them: the stream and its recording stay clean.'), box) };
  };

  // ---- the panel for one stream (opened from Live streams or a production)
  App.mcrPanel = (row) => {
    const id = row.id, title = row.title || 'Stream';
    const url = `/api/productions/${encodeURIComponent(id)}/mcr?team=${App.team}`;
    let st = null, skew = 0, ads = [], presets = [], picked = [], sqPicked = [], timer = null, tick = null, events = null;
    const sqOpt = { image: '', seconds: 20, pos: 'tr', sound: 'ad', text: '' };
    const adList = () => ads.filter((a) => (a.kind || 'ad') === 'ad'), sqList = () => ads.filter((a) => a.kind === 'squeeze');
    let slateOpt = { minutes: 0, mute: false, title: '', text: '', countTo: '' }, custom = '';
    const status = h('div', { class: 'mcr-status' });
    const slatesBox = h('div', {}), adsBox = h('div', {}), sqBox = h('div', {}), autoBox = h('div', {}), ovBox = h('div', {}), cueBox = h('div', {});
    const now = () => Date.now() + skew;
    const act = async (body, ok) => {
      try { const r = await api('POST', url, body); st = r.state; skew = r.now - Date.now(); paintAll(); if (ok) toast(ok); } catch (e) { oops(e); }
    };
    const load = async () => {
      try { const r = await api('GET', url); st = r.state; skew = r.now - Date.now(); events = r.events || events; } catch (e) { status.textContent = e.message; return; }
      paintStatus(); paintCues();
    };
    const loadAds = async () => {
      try { [ads, presets] = await Promise.all([libApi.ads(), libApi.presets()]); } catch (e) { ads = []; presets = []; }
      picked = picked.filter((x) => adList().some((a) => a.id === x)); sqPicked = sqPicked.filter((x) => sqList().some((a) => a.id === x));
      paintAds(); paintSqueeze(); paintAuto(); paintCues(); paintSlates();
    };
    const presetBtns = (kind) => {
      const list = presets.filter((p) => (p.kind === 'squeeze') === (kind === 'squeeze'));
      return h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', margin: '0 0 8px' } }, list.map((p) => h('button', { class: 'mcr-preset', title: presetText(p, ads), onclick: () => act({ action: 'preset', preset: p.id }, p.name + ' on') }, p.name)),
        App.canEdit('production') ? h('button', { class: 'sm ghost', onclick: () => editPreset({ kind: kind === 'squeeze' ? 'squeeze' : 'ads', ads: kind === 'squeeze' ? sqPicked : picked, ...(kind === 'squeeze' ? sqOpt : {}) }, ads, () => loadAds()) }, '+ Save as preset') : null);
    };

    function paintStatus() {
      if (!st) return;
      const t = now();
      const ad = st.ad && Date.parse(st.ad.endsAt) > t ? st.ad : null;
      const sl = st.slate && (!st.slate.until || Date.parse(st.slate.until) > t) ? st.slate : null;
      const sq = st.squeeze && Date.parse(st.squeeze.endsAt) > t ? st.squeeze : null;
      let sum = null;
      if (ad) { let acc = Date.parse(ad.startedAt), idx = 0; for (const [i, it] of ad.items.entries()) { if (t < acc + it.duration * 1000) { idx = i; break; } acc += it.duration * 1000; } sum = { ad: { endsAt: ad.endsAt, count: ad.items.length, index: idx } }; }
      else if (sl) sum = { slate: sl };
      else if (sq) sum = { squeeze: { endsAt: sq.endsAt, count: sq.items.length } };
      else if ((st.overlays || []).some((o) => o.on)) sum = { overlays: st.overlays.filter((o) => o.on).map((o) => o.kind) };
      const s = statusText(sum, t);
      status.className = 'mcr-status ' + s.cls;
      status.replaceChildren(h('b', {}, s.text), ad || sl || sq ? h('button', { class: 'sm', onclick: () => act({ action: 'clearAll' }, 'Back to the live picture') }, 'Back to live') : null);
    }
    function paintSlates() {
      const minutes = h('input', { type: 'number', min: 0, max: 1440, value: slateOpt.minutes || '', placeholder: 'until taken off', style: { width: '130px' }, oninput: (e) => { slateOpt.minutes = Number(e.target.value) || 0; } });
      const mute = h('input', { type: 'checkbox', checked: slateOpt.mute, onchange: (e) => { slateOpt.mute = e.target.checked; } });
      const tIn = h('input', { value: slateOpt.title, placeholder: custom === 'countdown' ? 'Title (e.g. Kick-off in)' : 'Title (e.g. Lightning in the area)', oninput: (e) => { slateOpt.title = e.target.value; } });
      const toIn = h('input', { type: 'datetime-local', value: slateOpt.countTo, style: { width: '210px' }, oninput: (e) => { slateOpt.countTo = e.target.value; } });
      const xIn = h('textarea', { rows: 2, placeholder: 'Message (optional)', oninput: (e) => { slateOpt.text = e.target.value; } }, slateOpt.text);
      slatesBox.replaceChildren(
        h('div', { class: 'mcr-btns' }, KINDS.map(([k, l]) => h('button', { class: 'mcr-slate k-' + k + (st && st.slate && st.slate.kind === k ? ' on' : ''), onclick: () => {
          if ((k === 'custom' || k === 'countdown') && custom !== k) { custom = k; paintSlates(); return; }
          if (k === 'custom' && !slateOpt.title.trim()) { toast('Type a title for the slate', 'error'); return; }
          if (k === 'countdown' && !slateOpt.countTo && !slateOpt.minutes) { toast('Choose the time to count down to, or the minutes', 'error'); return; }
          act({ action: 'slate', kind: k, minutes: slateOpt.minutes, mute: slateOpt.mute, ...(k === 'custom' || k === 'countdown' ? { title: slateOpt.title, text: slateOpt.text } : {}),
            ...(k === 'countdown' && slateOpt.countTo ? { countTo: new Date(slateOpt.countTo).toISOString() } : {}) }, k === 'countdown' ? 'Countdown on' : 'Slate on');
        } }, l))),
        custom ? h('div', { class: 'mcr-custom' }, tIn, xIn,
          custom === 'countdown' ? h('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, h('span', { class: 'small' }, 'Count down to'), toIn, h('span', { class: 'dim small' }, 'or set the minutes under "For". It goes off by itself at zero, back to the live picture.')) : null,
          h('div', { class: 'dim small' }, `Press ${custom === 'countdown' ? 'Countdown…' : 'Custom…'} again to put it on.`)) : null,
        h('div', { class: 'row', style: { gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'For'), minutes, h('span', { class: 'small' }, 'min')),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'Music'),
            h('select', { style: { width: 'auto' }, onchange: (e) => act({ action: 'setMusic', music: e.target.value }, e.target.value ? 'Slate music set' : 'No slate music') },
              h('option', { value: '' }, 'None (the live sound)'), ads.filter((a) => a.kind === 'music').map((a) => h('option', { value: a.id, selected: st && st.slateMusic === a.id }, a.title)))),
          App.canEdit('production') ? uploadBtn('music', '+ Music', () => loadAds()) : null,
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, mute, h('span', { class: 'small' }, 'No music: mute the stream sound under it')),
          st && st.slate ? h('button', { class: 'sm', onclick: () => act({ action: 'clearSlate' }, 'Slate off') }, 'Take slate off') : null));
    }
    function paintAds() {
      const total = picked.reduce((n, x) => n + ((ads.find((a) => a.id === x) || {}).duration || 0), 0);
      const can = App.canEdit('production');
      adsBox.replaceChildren(
        presetBtns('ads'),
        videoTable(adList(), { picked, onPick: (id, on) => { picked = on ? [...picked, id] : picked.filter((x) => x !== id); paintAds(); }, reload: loadAds }),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
          h('button', { class: 'primary', disabled: picked.length ? null : '', onclick: () => act({ action: 'ads', ads: picked }, 'Ad break started') }, picked.length ? `Play ad break now (${picked.length} · ${dur(total)})` : 'Tick videos or press a preset'),
          st && st.ad ? h('button', { class: 'danger', onclick: () => act({ action: 'stopAds' }, 'Back to the live picture') }, 'Stop ads') : null,
          can ? uploadBtn('ad', '+ Add video', (ad) => { picked.push(ad.id); loadAds(); }) : null,
          h('a', { class: 'small', href: '#/streamads', onclick: () => document.querySelector('.veil') && document.querySelector('.veil').remove() }, 'Manage adverts and presets')),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Viewers in the app see the adverts instead of the live picture, one after the other; the stream and its recording stay clean. The scorer, graphics control and confidence monitor on the production PC count down to the end of the break.'));
    }
    // squeeze-back: its own videos (or a sponsor board for some seconds) fill the frame, the live picture at 3/4 in a corner
    function paintSqueeze() {
      const total = sqPicked.reduce((n, x) => n + ((ads.find((a) => a.id === x) || {}).duration || 0), 0);
      const sel = (key, opts) => h('select', { style: { width: 'auto' }, onchange: (e) => { sqOpt[key] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(sqOpt[key]) === String(v) }, l)));
      const board = typeof imageField === 'function' ? imageField(sqOpt.image, (v) => { sqOpt.image = v || ''; }, 'sponsor') : null;
      sqBox.replaceChildren(
        presetBtns('squeeze'),
        videoTable(sqList(), { picked: sqPicked, onPick: (id, on) => { sqPicked = on ? [...sqPicked, id] : sqPicked.filter((x) => x !== id); paintSqueeze(); }, reload: loadAds }),
        h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
          h('span', { class: 'small' }, 'Live picture'), sel('pos', POS),
          h('span', { class: 'small' }, 'Sound'), sel('sound', [['ad', 'The advert'], ['live', 'The live stream']]),
          h('input', { value: sqOpt.text, placeholder: 'Text on the board (optional)', style: { width: '220px' }, oninput: (e) => { sqOpt.text = e.target.value; } })),
        h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '8px' } },
          h('div', { style: { minWidth: '220px' } }, h('div', { class: 'dim small' }, 'Sponsor board (behind the picture, or on its own)'), board),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'Board on its own for'), h('input', { type: 'number', min: 5, max: 600, value: sqOpt.seconds, style: { width: '80px' }, oninput: (e) => { sqOpt.seconds = Number(e.target.value) || 20; } }), h('span', { class: 'small' }, 'seconds'))),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          h('button', { class: 'primary', onclick: () => act({ action: 'squeeze', ads: sqPicked, ...sqOpt }, 'Squeeze-back on') }, sqPicked.length ? `Squeeze back now (${sqPicked.length} video${sqPicked.length > 1 ? 's' : ''} · ${dur(total)})` : 'Squeeze back now (sponsor board)'),
          st && st.squeeze ? h('button', { class: 'danger', onclick: () => act({ action: 'stopSqueeze' }, 'Full screen again') }, 'Full screen again') : null,
          App.canEdit('production') ? uploadBtn('squeeze', '+ Add video', (ad) => { sqPicked.push(ad.id); loadAds(); }) : null),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'The live picture slides to three quarters in the corner, flush with its edges, with the squeeze-back videos or the board behind it. The stream and its recording stay clean.'));
    }
    // automation: game events from the scorer run a squeeze-back, an ad break or a slate by themselves
    function paintAuto() {
      const rules = ((st && st.auto) || []).map((r) => ({ ...r }));
      const save = (msg) => act({ action: 'setAuto', rules }, msg);
      const evs = events ? [...new Map([...(events.sport || []), ...(events.cricket || [])].map(([k, l]) => [k, l])).entries()] : [['try', 'Try'], ['wicket', 'Wicket']];
      const adName = (ids) => ids.length ? ids.map((x) => (ads.find((a) => a.id === x) || {}).title || '?').join(', ') : 'sponsor board';
      const pName = (id) => (presets.find((p) => p.id === id) || {}).name || 'a deleted preset';
      autoBox.replaceChildren(
        rules.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, rules.map((r, i) => h('tr', {},
          h('td', { style: { width: '34px' } }, h('input', { type: 'checkbox', checked: r.on, title: 'On', onchange: (e) => { r.on = e.target.checked; save(); } })),
          h('td', {}, h('b', {}, 'When ' + ((evs.find((x) => x[0] === r.when) || [, r.when])[1]).toLowerCase()), r.team ? ` (team ${r.team === 'A' ? '1' : '2'})` : ''),
          h('td', {}, r.do === 'preset' ? `Preset: ${pName(r.preset)}` : r.do === 'squeeze' ? `Squeeze-back: ${adName(r.ads)}${r.ads.length ? '' : ` for ${r.seconds} s`}` : r.do === 'ads' ? `Ad break: ${adName(r.ads)}` : `Slate: ${(KINDS.find((k) => k[0] === r.kind) || [, r.kind])[1]}`),
          h('td', { class: 'dim small nowrap' }, [r.delay ? `after ${r.delay} s` : 'at once', `rests ${Math.round(r.cooldown / 60 * 10) / 10} min`].join(' · ')),
          h('td', {}, h('button', { class: 'sm ghost danger', onclick: () => { rules.splice(i, 1); save('Rule removed'); } }, '✕'))))))) : h('p', { class: 'dim', style: { margin: '0 0 8px' } }, 'No rules yet.'),
        (() => {
          const d = { when: evs[0][0], team: '', do: presets.length ? 'preset' : 'squeeze', preset: presets.length ? presets[0].id : '', delay: 5, cooldown: 120, kind: 'break' };
          const pSel = h('select', { style: { width: 'auto', display: d.do === 'preset' ? '' : 'none' }, onchange: (e) => { d.preset = e.target.value; } }, presets.map((p) => h('option', { value: p.id }, p.name)));
          return h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { class: 'small' }, 'When'), h('select', { style: { width: 'auto' }, onchange: (e) => { d.when = e.target.value; } }, evs.map(([k, l]) => h('option', { value: k }, l))),
            h('select', { style: { width: 'auto' }, onchange: (e) => { d.team = e.target.value; } }, [['', 'either team'], ['A', 'team 1'], ['B', 'team 2']].map(([v, l]) => h('option', { value: v }, l))),
            h('span', { class: 'small' }, 'then'), h('select', { style: { width: 'auto' }, onchange: (e) => { d.do = e.target.value; pSel.style.display = d.do === 'preset' ? '' : 'none'; } }, [...(presets.length ? [['preset', 'Preset']] : []), ['squeeze', 'Squeeze-back (as set above)'], ['ads', 'Ad break (ticked videos)'], ['slate', 'Slate (right back)']].map(([v, l]) => h('option', { value: v, selected: d.do === v }, l))),
            pSel,
            h('span', { class: 'small' }, 'after'), h('input', { type: 'number', min: 0, max: 120, value: d.delay, style: { width: '70px' }, oninput: (e) => { d.delay = Number(e.target.value) || 0; } }), h('span', { class: 'small' }, 's, at most every'),
            h('input', { type: 'number', min: 0, max: 60, value: d.cooldown / 60, style: { width: '70px' }, oninput: (e) => { d.cooldown = (Number(e.target.value) || 0) * 60; } }), h('span', { class: 'small' }, 'min'),
            h('button', { class: 'sm', onclick: () => {
              if (d.do === 'ads' && !picked.length) return toast('Tick the adverts under Ad break first', 'error');
              if (d.do === 'squeeze' && !sqPicked.length && !sqOpt.image) return toast('Tick squeeze-back videos, or choose a sponsor board under Squeeze-back', 'error');
              if (d.do === 'preset' && !d.preset) return toast('Pick a preset', 'error');
              rules.push({ ...d, on: true, ads: (d.do === 'squeeze' ? sqPicked : picked).slice(), image: sqOpt.image, seconds: sqOpt.seconds, pos: sqOpt.pos, sound: sqOpt.sound });
              save('Rule added');
            } }, 'Add rule'));
        })(),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'The scorer on the production PC reports the events (the PC must be signed in to this website). A rule never starts on top of an ad break, squeeze-back or slate, and rests for the time you set. The delay lets the replay or celebration play out first. A preset (Advertising → Stream adverts) is the easiest; otherwise the videos and settings ticked above are used.'));
    }
    function paintOverlays() {
      const cur = new Map(((st && st.overlays) || []).map((o) => [o.kind, { ...o }]));
      const rows = OVL.map(([k]) => cur.get(k) || { kind: k, on: false, text: '', sub: '', image: '', pos: k === 'bug' ? 'tr' : k === 'image' ? 'br' : 'bl' });
      const save = (msg) => act({ action: 'overlays', overlays: rows }, msg);
      const inp = (o, key, ph, w) => h('input', { value: o[key] || '', placeholder: ph, style: w ? { width: w } : {}, oninput: (e) => { o[key] = e.target.value; }, onchange: () => { if (o.on) save(); } });
      const pos = (o, opts) => h('select', { style: { width: 'auto' }, onchange: (e) => { o.pos = e.target.value; if (o.on) save(); } }, (opts || POS).map(([v, l]) => h('option', { value: v, selected: o.pos === v }, l)));
      ovBox.replaceChildren(...rows.map((o, i) => {
        const [, label, help] = OVL[i];
        const img = (o.kind === 'bug' || o.kind === 'image') && typeof imageField === 'function' ? imageField(o.image, (v) => { o.image = v || ''; if (o.on) save(); }, 'overlay') : null;
        return h('div', { class: 'mcr-ov' + (o.on ? ' on' : '') },
          h('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } },
            h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: o.on, onchange: (e) => { o.on = e.target.checked; save(o.on ? label + ' on' : label + ' off'); } }), h('b', {}, label)),
            h('span', { class: 'dim small' }, help)),
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '6px' } },
            o.kind === 'bug' ? [inp(o, 'text', 'LIVE', '120px'), pos(o)] : null,
            o.kind === 'lower' ? [inp(o, 'text', 'Name or headline', '220px'), inp(o, 'sub', 'Second line', '220px'), pos(o, [['bl', 'Left'], ['br', 'Right']])] : null,
            o.kind === 'ticker' ? [inp(o, 'text', 'Next match: …', '360px'), inp(o, 'sub', 'More (optional)', '220px')] : null,
            o.kind === 'image' ? [pos(o)] : null,
            img ? h('div', { style: { minWidth: '220px' } }, img) : null));
      }));
    }
    function paintCues() {
      const cues = ((st && st.cues) || []).slice().sort((a, b) => a.at.localeCompare(b.at));
      const d = { at: local(Date.now() + 10 * 60e3), do: 'slate', kind: 'break', minutes: 0, mute: true };
      const what = (c) => c.do === 'preset' ? 'Preset: ' + ((presets.find((p) => p.id === c.preset) || {}).name || '?') : c.do === 'squeeze' ? 'Squeeze-back' : c.do === 'stopSqueeze' ? 'End squeeze-back' : c.do === 'slate' ? `Slate: ${(KINDS.find((k) => k[0] === c.kind) || [, c.kind])[1]}${c.minutes ? ` for ${c.minutes} min` : ''}` : c.do === 'ads' ? `Ad break (${c.ads.length})` : c.do === 'clearSlate' ? 'Take slate off' : 'Stop ads';
      d.preset = presets.length ? presets[0].id : '';
      const pSel = h('select', { style: { width: 'auto', display: 'none' }, onchange: (e) => { d.preset = e.target.value; } }, presets.map((p) => h('option', { value: p.id }, p.name)));
      const kindSel = h('select', { style: { width: 'auto' }, onchange: (e) => { d.kind = e.target.value; } }, KINDS.filter((k) => k[0] !== 'custom').map(([k, l]) => h('option', { value: k, selected: d.kind === k }, l)));
      cueBox.replaceChildren(
        cues.length ? h('table', { class: 't' }, h('tbody', {}, cues.map((c) => h('tr', {}, h('td', { class: 'nowrap' }, new Date(c.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })), h('td', {}, what(c)),
          h('td', { class: 'nowrap dim small' }, 'in ' + dur((Date.parse(c.at) - now()) / 1000)), h('td', {}, h('button', { class: 'sm ghost danger', onclick: () => act({ action: 'removeCue', id: c.id }) }, '✕')))))) : h('p', { class: 'dim', style: { margin: '0 0 8px' } }, 'Nothing scheduled.'),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { type: 'datetime-local', value: d.at, style: { width: '200px' }, onchange: (e) => { d.at = e.target.value; } }),
          h('select', { style: { width: 'auto' }, onchange: (e) => { d.do = e.target.value; kindSel.style.display = d.do === 'slate' ? '' : 'none'; pSel.style.display = d.do === 'preset' ? '' : 'none'; } },
            [['slate', 'Slate'], ...(presets.length ? [['preset', 'Preset']] : []), ['ads', 'Ad break (the ticked adverts)'], ['squeeze', 'Squeeze-back (as set above)'], ['clearSlate', 'Take slate off'], ['stopAds', 'Stop ads'], ['stopSqueeze', 'End squeeze-back']].map(([v, l]) => h('option', { value: v }, l))),
          kindSel, pSel,
          h('input', { type: 'number', min: 0, placeholder: 'min', title: 'Minutes (empty: until taken off)', style: { width: '80px' }, oninput: (e) => { d.minutes = Number(e.target.value) || 0; } }),
          h('button', { class: 'sm', onclick: () => {
            if (d.do === 'ads' && !picked.length) return toast('Tick the adverts for the break under Ad break first', 'error');
            if (d.do === 'squeeze' && !sqPicked.length && !sqOpt.image) return toast('Tick squeeze-back videos or choose a sponsor board first', 'error');
            act({ action: 'addCue', at: new Date(d.at).toISOString(), do: d.do, preset: d.preset, kind: d.kind, minutes: d.minutes, mute: false, ads: d.do === 'squeeze' ? sqPicked : picked, image: sqOpt.image, seconds: sqOpt.seconds, pos: sqOpt.pos, sound: sqOpt.sound }, 'Scheduled');
          } }, 'Schedule')));
    }
    function paintAll() { paintStatus(); paintSlates(); paintAds(); paintSqueeze(); paintAuto(); paintOverlays(); paintCues(); }

    const body = h('div', { class: 'mcr' },
      h('p', { class: 'dim', style: { marginTop: '-6px' } }, 'Only viewers in the app see these: the stream itself and its recording stay clean.'),
      status,
      h('h3', {}, 'Slates'), slatesBox,
      h('h3', {}, 'Ad break'), adsBox,
      h('h3', {}, 'Squeeze-back'), sqBox,
      h('h3', {}, 'Automatic, on game events'), autoBox,
      h('h3', {}, 'Graphics over the picture'), ovBox,
      h('h3', {}, 'Schedule'), cueBox);
    const close = UI.modal({ title: 'Master control · ' + title, body, wide: true, actions: [{ label: 'Close' }] });
    load().then(paintAll); loadAds();
    timer = setInterval(() => { if (!body.isConnected) { clearInterval(timer); clearInterval(tick); return; } load(); }, 3000);
    tick = setInterval(() => { if (body.isConnected) paintStatus(); }, 500);
    return close;
  };

  // ---- the Studio: a countdown banner while one of the team's streams is in an ad break or on a slate
  let banner = null, active = { now: 0, list: [] }, skewB = 0;
  const paintBanner = () => {
    const t = Date.now() + skewB;
    const list = active.list.filter((x) => (x.ad && Date.parse(x.ad.endsAt) > t) || (x.squeeze && Date.parse(x.squeeze.endsAt) > t) || (x.slate && (!x.slate.until || Date.parse(x.slate.until) > t)));
    if (!list.length) { if (banner) banner.remove(); return; }
    if (!banner) banner = h('a', { class: 'mcr-banner', href: '#/streams' });
    if (!banner.isConnected) document.body.append(banner);
    banner.replaceChildren(...list.map((x) => h('div', { class: x.ad || x.squeeze ? 'ad' : 'slate' }, h('b', {}, x.title), ' · ', statusText(x.ad ? { ad: x.ad } : x.squeeze ? { squeeze: x.squeeze } : { slate: x.slate }, t).text)));
  };
  setInterval(async () => {
    if (!App.cfg || App.cfg.mode !== 'cloud' || !App.me || document.hidden) return;
    try { active = await api('GET', '/api/mcr/active'); skewB = active.now - Date.now(); } catch (e) { active = { now: 0, list: [] }; }
  }, 5000);
  setInterval(paintBanner, 500);
})();
