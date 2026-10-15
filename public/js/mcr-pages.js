/* Master control (MCR) for a live stream, in the Studio: slates, ad breaks with video adverts, graphics over the
 * picture and a schedule of cues. All of it happens in the viewers' players (the website's app), so the feed and its
 * recording stay clean. Also the ad-break countdown banner across the Studio. */
'use strict';
(() => {
  const dur = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const h2 = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h2 ? h2 + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const KINDS = [['technical', 'Technical difficulties'], ['connection', 'Connection issues'], ['weather', 'Weather delay'], ['break', 'Right back'], ['starting', 'Starting soon'], ['custom', 'Custom…']];
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

  // ---- the panel for one stream (opened from Live streams or a production)
  App.mcrPanel = (row) => {
    const id = row.id, title = row.title || 'Stream';
    const url = `/api/productions/${encodeURIComponent(id)}/mcr?team=${App.team}`;
    let st = null, skew = 0, ads = [], picked = [], timer = null, tick = null, events = null;
    const sqOpt = { image: '', seconds: 20, pos: 'tr', size: 62, sound: 'ad', text: '' };
    let slateOpt = { minutes: 0, mute: true, title: '', text: '' }, custom = false;
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
    const loadAds = async () => { try { ads = (await api('GET', '/api/videoads?team=' + App.team)).list; } catch (e) { ads = []; } picked = picked.filter((x) => ads.some((a) => a.id === x)); paintAds(); };

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
      const tIn = h('input', { value: slateOpt.title, placeholder: 'Title (e.g. Lightning in the area)', oninput: (e) => { slateOpt.title = e.target.value; } });
      const xIn = h('textarea', { rows: 2, placeholder: 'Message (optional)', oninput: (e) => { slateOpt.text = e.target.value; } }, slateOpt.text);
      slatesBox.replaceChildren(
        h('div', { class: 'mcr-btns' }, KINDS.map(([k, l]) => h('button', { class: 'mcr-slate k-' + k + (st && st.slate && st.slate.kind === k ? ' on' : ''), onclick: () => {
          if (k === 'custom' && !custom) { custom = true; paintSlates(); return; }
          if (k === 'custom' && !slateOpt.title.trim()) { toast('Type a title for the slate', 'error'); return; }
          act({ action: 'slate', kind: k, minutes: slateOpt.minutes, mute: slateOpt.mute, ...(k === 'custom' ? { title: slateOpt.title, text: slateOpt.text } : {}) }, 'Slate on');
        } }, l))),
        custom ? h('div', { class: 'mcr-custom' }, tIn, xIn, h('div', { class: 'dim small' }, 'Press Custom… again to put it on.')) : null,
        h('div', { class: 'row', style: { gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'For'), minutes, h('span', { class: 'small' }, 'min')),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, mute, h('span', { class: 'small' }, 'Mute the stream sound under it')),
          st && st.slate ? h('button', { class: 'sm', onclick: () => act({ action: 'clearSlate' }, 'Slate off') }, 'Take slate off') : null));
    }
    function paintAds() {
      if (sqBox.isConnected) setTimeout(paintSqueeze, 0);
      const total = picked.reduce((n, x) => n + ((ads.find((a) => a.id === x) || {}).duration || 0), 0);
      const file = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/webm', style: { display: 'none' }, onchange: () => { if (file.files[0]) upload(file.files[0]); file.value = ''; } });
      const prog = h('span', { class: 'dim small' });
      const upload = async (f) => {
        const secs = await new Promise((resolve) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { resolve(v.duration || 0); URL.revokeObjectURL(v.src); }; v.onerror = () => resolve(0); v.src = URL.createObjectURL(f); });
        const x = new XMLHttpRequest();
        x.open('POST', `/api/videoads?team=${App.team}&name=${encodeURIComponent(f.name)}&duration=${secs || ''}`);
        x.setRequestHeader('x-rfp', '1'); x.setRequestHeader('content-type', f.type || 'video/mp4');
        x.upload.onprogress = (e) => { if (e.lengthComputable) prog.textContent = `Uploading ${f.name}: ${Math.round((e.loaded / e.total) * 100)}%`; };
        x.onload = () => { prog.textContent = ''; let r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not json */ } if (x.status >= 300) return toast(r.error || 'Upload failed', 'error'); toast('Advert added'); picked.push(r.ad.id); loadAds(); };
        x.onerror = () => { prog.textContent = ''; toast('Upload failed', 'error'); };
        x.send(f);
      };
      const can = App.canEdit('production');
      adsBox.replaceChildren(
        ads.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, ads.map((a) => {
          const n = picked.indexOf(a.id);
          return h('tr', {},
            h('td', { style: { width: '34px' } }, h('input', { type: 'checkbox', checked: n >= 0, onchange: (e) => { if (e.target.checked) picked.push(a.id); else picked = picked.filter((x) => x !== a.id); paintAds(); } })),
            h('td', { style: { width: '28px' } }, n >= 0 ? h('span', { class: 'pill' }, String(n + 1)) : null),
            h('td', {}, h('b', {}, a.title)), h('td', { class: 'nowrap dim' }, dur(a.duration)),
            h('td', { class: 'nowrap' }, h('a', { class: 'btn sm ghost', href: a.url, target: '_blank', rel: 'noopener' }, 'Preview'),
              can ? h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox(`Delete the advert "${a.title}"?`))) return; try { await api('DELETE', `/api/videoads/${a.id}?team=${App.team}`); loadAds(); } catch (e) { oops(e); } } }, '✕') : null));
        })))) : h('p', { class: 'dim', style: { margin: '0 0 8px' } }, 'No video adverts yet. Add MP4 files (H.264 + AAC plays on every phone and browser).'),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
          h('button', { class: 'primary', disabled: picked.length ? null : '', onclick: () => act({ action: 'ads', ads: picked }, 'Ad break started') }, picked.length ? `Play ad break now (${picked.length} · ${dur(total)})` : 'Tick adverts to play'),
          st && st.ad ? h('button', { class: 'danger', onclick: () => act({ action: 'stopAds' }, 'Back to the live picture') }, 'Stop ads') : null,
          can ? h('button', { class: 'sm', onclick: () => file.click() }, '+ Add video advert') : null, file, prog),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Viewers in the app see the adverts instead of the live picture, one after the other; the stream and its recording stay clean. The scorer, graphics control and confidence monitor on the production PC count down to the end of the break.'));
    }
    // squeeze-back: the ticked adverts (or a sponsor board for some seconds) fill the frame, the live picture in a corner
    function paintSqueeze() {
      const total = picked.reduce((n, x) => n + ((ads.find((a) => a.id === x) || {}).duration || 0), 0);
      const sel = (key, opts) => h('select', { style: { width: 'auto' }, onchange: (e) => { sqOpt[key] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(sqOpt[key]) === String(v) }, l)));
      const board = typeof imageField === 'function' ? imageField(sqOpt.image, (v) => { sqOpt.image = v || ''; }, 'sponsor') : null;
      sqBox.replaceChildren(
        h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
          h('span', { class: 'small' }, 'Live picture'), sel('pos', POS), sel('size', [[50, 'Half size'], [62, 'Two thirds'], [72, 'Three quarters']]),
          h('span', { class: 'small' }, 'Sound'), sel('sound', [['ad', 'The advert'], ['live', 'The live stream']]),
          h('input', { value: sqOpt.text, placeholder: 'Text on the board (optional)', style: { width: '220px' }, oninput: (e) => { sqOpt.text = e.target.value; } })),
        h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '8px' } },
          h('div', { style: { minWidth: '220px' } }, h('div', { class: 'dim small' }, 'Sponsor board (shown behind, or when no advert is ticked)'), board),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'small' }, 'Board for'), h('input', { type: 'number', min: 5, max: 600, value: sqOpt.seconds, style: { width: '80px' }, oninput: (e) => { sqOpt.seconds = Number(e.target.value) || 20; } }), h('span', { class: 'small' }, 'seconds'))),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'primary', onclick: () => act({ action: 'squeeze', ads: picked, ...sqOpt }, 'Squeeze-back on') }, picked.length ? `Squeeze back now (${picked.length} advert${picked.length > 1 ? 's' : ''} · ${dur(total)})` : 'Squeeze back now (sponsor board)'),
          st && st.squeeze ? h('button', { class: 'danger', onclick: () => act({ action: 'stopSqueeze' }, 'Full screen again') }, 'Full screen again') : null),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'The adverts ticked under Ad break play behind the live picture. Viewers keep watching the game; the stream and its recording stay clean.'));
    }
    // automation: game events from the scorer run a squeeze-back, an ad break or a slate by themselves
    function paintAuto() {
      const rules = ((st && st.auto) || []).map((r) => ({ ...r }));
      const save = (msg) => act({ action: 'setAuto', rules }, msg);
      const evs = events ? [...new Map([...(events.sport || []), ...(events.cricket || [])].map(([k, l]) => [k, l])).entries()] : [['try', 'Try'], ['wicket', 'Wicket']];
      const adName = (ids) => ids.length ? ids.map((x) => (ads.find((a) => a.id === x) || {}).title || '?').join(', ') : 'sponsor board';
      autoBox.replaceChildren(
        rules.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, rules.map((r, i) => h('tr', {},
          h('td', { style: { width: '34px' } }, h('input', { type: 'checkbox', checked: r.on, title: 'On', onchange: (e) => { r.on = e.target.checked; save(); } })),
          h('td', {}, h('b', {}, 'When ' + ((evs.find((x) => x[0] === r.when) || [, r.when])[1]).toLowerCase()), r.team ? ` (team ${r.team === 'A' ? '1' : '2'})` : ''),
          h('td', {}, r.do === 'squeeze' ? `Squeeze-back: ${adName(r.ads)}${r.ads.length ? '' : ` for ${r.seconds} s`}` : r.do === 'ads' ? `Ad break: ${adName(r.ads)}` : `Slate: ${(KINDS.find((k) => k[0] === r.kind) || [, r.kind])[1]}`),
          h('td', { class: 'dim small nowrap' }, [r.delay ? `after ${r.delay} s` : 'at once', `rests ${Math.round(r.cooldown / 60 * 10) / 10} min`].join(' · ')),
          h('td', {}, h('button', { class: 'sm ghost danger', onclick: () => { rules.splice(i, 1); save('Rule removed'); } }, '✕'))))))) : h('p', { class: 'dim', style: { margin: '0 0 8px' } }, 'No rules yet.'),
        (() => {
          const d = { when: evs[0][0], team: '', do: 'squeeze', delay: 5, cooldown: 120, kind: 'break' };
          return h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { class: 'small' }, 'When'), h('select', { style: { width: 'auto' }, onchange: (e) => { d.when = e.target.value; } }, evs.map(([k, l]) => h('option', { value: k }, l))),
            h('select', { style: { width: 'auto' }, onchange: (e) => { d.team = e.target.value; } }, [['', 'either team'], ['A', 'team 1'], ['B', 'team 2']].map(([v, l]) => h('option', { value: v }, l))),
            h('span', { class: 'small' }, 'then'), h('select', { style: { width: 'auto' }, onchange: (e) => { d.do = e.target.value; } }, [['squeeze', 'Squeeze-back'], ['ads', 'Full ad break'], ['slate', 'Slate (right back)']].map(([v, l]) => h('option', { value: v }, l))),
            h('span', { class: 'small' }, 'after'), h('input', { type: 'number', min: 0, max: 120, value: d.delay, style: { width: '70px' }, oninput: (e) => { d.delay = Number(e.target.value) || 0; } }), h('span', { class: 'small' }, 's, at most every'),
            h('input', { type: 'number', min: 0, max: 60, value: d.cooldown / 60, style: { width: '70px' }, oninput: (e) => { d.cooldown = (Number(e.target.value) || 0) * 60; } }), h('span', { class: 'small' }, 'min'),
            h('button', { class: 'sm', onclick: () => {
              if (d.do === 'ads' && !picked.length) return toast('Tick the adverts under Ad break first', 'error');
              if (d.do === 'squeeze' && !picked.length && !sqOpt.image) return toast('Tick adverts under Ad break, or choose a sponsor board under Squeeze-back', 'error');
              rules.push({ ...d, on: true, ads: picked.slice(), image: sqOpt.image, seconds: sqOpt.seconds, pos: sqOpt.pos, sound: sqOpt.sound });
              save('Rule added');
            } }, 'Add rule'));
        })(),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'The scorer on the production PC reports the events (the PC must be signed in to this website). A rule never starts on top of an ad break, squeeze-back or slate, and rests for the time you set. The delay lets the replay or celebration play out first. The ads and squeeze-back settings ticked above are used for the rule.'));
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
      const what = (c) => c.do === 'squeeze' ? 'Squeeze-back' : c.do === 'stopSqueeze' ? 'End squeeze-back' : c.do === 'slate' ? `Slate: ${(KINDS.find((k) => k[0] === c.kind) || [, c.kind])[1]}${c.minutes ? ` for ${c.minutes} min` : ''}` : c.do === 'ads' ? `Ad break (${c.ads.length})` : c.do === 'clearSlate' ? 'Take slate off' : 'Stop ads';
      const kindSel = h('select', { style: { width: 'auto' }, onchange: (e) => { d.kind = e.target.value; } }, KINDS.filter((k) => k[0] !== 'custom').map(([k, l]) => h('option', { value: k, selected: d.kind === k }, l)));
      cueBox.replaceChildren(
        cues.length ? h('table', { class: 't' }, h('tbody', {}, cues.map((c) => h('tr', {}, h('td', { class: 'nowrap' }, new Date(c.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })), h('td', {}, what(c)),
          h('td', { class: 'nowrap dim small' }, 'in ' + dur((Date.parse(c.at) - now()) / 1000)), h('td', {}, h('button', { class: 'sm ghost danger', onclick: () => act({ action: 'removeCue', id: c.id }) }, '✕')))))) : h('p', { class: 'dim', style: { margin: '0 0 8px' } }, 'Nothing scheduled.'),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { type: 'datetime-local', value: d.at, style: { width: '200px' }, onchange: (e) => { d.at = e.target.value; } }),
          h('select', { style: { width: 'auto' }, onchange: (e) => { d.do = e.target.value; kindSel.style.display = d.do === 'slate' ? '' : 'none'; } },
            [['slate', 'Slate'], ['ads', 'Ad break (the ticked adverts)'], ['squeeze', 'Squeeze-back (as set above)'], ['clearSlate', 'Take slate off'], ['stopAds', 'Stop ads'], ['stopSqueeze', 'End squeeze-back']].map(([v, l]) => h('option', { value: v }, l))),
          kindSel,
          h('input', { type: 'number', min: 0, placeholder: 'min', title: 'Minutes (empty: until taken off)', style: { width: '80px' }, oninput: (e) => { d.minutes = Number(e.target.value) || 0; } }),
          h('button', { class: 'sm', onclick: () => {
            if (d.do === 'ads' && !picked.length) return toast('Tick the adverts for the break under Ad break first', 'error');
            if (d.do === 'squeeze' && !picked.length && !sqOpt.image) return toast('Tick adverts or choose a sponsor board first', 'error');
            act({ action: 'addCue', at: new Date(d.at).toISOString(), do: d.do, kind: d.kind, minutes: d.minutes, mute: true, ads: picked, image: sqOpt.image, seconds: sqOpt.seconds, pos: sqOpt.pos, sound: sqOpt.sound }, 'Scheduled');
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
