/* RFP Manager – worship control: service order and library on the left, slides in the middle, live output and tools on the right. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private */ } } };
  const newId = p => p + '_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-3);

  let me = null, team = '', role = '', docs = new Map(), live = null, bibles = [];
  let serviceId = store.get('w.service', ''), sel = null;      // sel: what the middle shows { item } | { song } | { adhoc }
  let lib = store.get('w.lib', 'songs'), side = store.get('w.side', 'names'), q = '', passage = null, macrosFull = null;

  function toast(msg, kind) {
    const t = h(`<div class="toast ${kind || ''}">${esc(msg)}</div>`);
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, kind === 'err' ? 5000 : 2200);
  }
  async function api(method, url, body, raw) {
    const r = await fetch(url, { method, headers: Object.assign({ 'x-rfp': '1' }, body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) { const err = new Error((j && j.error) || r.statusText); err.status = r.status; throw err; }
    return j;
  }
  const act = (action, extra) => api('POST', '/worship/api/act', Object.assign({ action, team }, extra || {})).then(s => { setLive(s); return s; }).catch(e => { toast(e.message, 'err'); return null; });
  const list = type => [...docs.values()].filter(d => d.type === type && !d.deleted);
  const data = id => (docs.get(id) && !docs.get(id).deleted ? docs.get(id).data : null);
  const org = () => data(team) || {};
  const wset = () => org().worship || {};
  const canEdit = () => role === 'Admin' || role === 'Producer';
  const ctx = () => ({ song: id => (docs.get(id) && docs.get(id).type === 'song' ? data(id) : null), licence: wset().ccliLicence || '', showCopyright: (wset().look || {}).showCopyright !== false, look: Object.assign({ linesPerSlide: 4 }, wset().look || {}) });
  const service = () => (docs.get(serviceId) && docs.get(serviceId).type === 'service' ? docs.get(serviceId) : null);

  async function loadDocs() {
    const r = await api('GET', '/api/docs?team=' + encodeURIComponent(team));
    docs = new Map(r.docs.map(d => [d.id, d]));
  }
  async function saveService(mutate) {
    const sv = service();
    if (!sv) return toast('Choose or create a service first', 'err');
    if (!canEdit()) return toast('You need the Producer role to change the order of service', 'err');
    const d = JSON.parse(JSON.stringify(sv.data)); d.items = d.items || [];
    if (mutate(d) === false) return;
    try { const r = await api('PUT', `/api/docs/service/${sv.id}?team=${encodeURIComponent(team)}`, { data: d }); docs.set(sv.id, r.doc); renderAll(); } catch (e) { toast(e.message, 'err'); }
  }
  const addItem = item => saveService(d => { d.items.push(Object.assign({ id: newId('it') }, item)); });

  // ------------------------------------------------------------------------------------------ left: service
  const KIND = { song: ['#3b82f6', 'Song'], scripture: ['#0ea5e9', 'Scripture'], text: ['#f59e0b', 'Text'], media: ['#10b981', 'Media'] };
  const itemTitle = it => (it.kind === 'song' ? ((data(it.song) || {}).title || 'Missing song') : it.title || it.ref || (it.kind === 'text' ? String(it.text || '').split('\n')[0].replace(/^#\s*/, '') : '') || KIND[it.kind][1]);
  function renderService() {
    const svs = list('service').sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')) || String(a.data.name).localeCompare(String(b.data.name)));
    if (!service() && svs.length) { const today = new Date().toLocaleDateString('en-CA'); serviceId = (svs.find(s => s.data.date === today) || svs.find(s => (s.data.date || '') >= today) || svs[0]).id; }
    $('#sv-pick').innerHTML = svs.length ? svs.map(s => `<option value="${esc(s.id)}" ${s.id === serviceId ? 'selected' : ''}>${esc([s.data.date, s.data.name].filter(Boolean).join(' · '))}</option>`).join('') : '<option value="">No services yet</option>';
    const sv = service(), items = sv ? sv.data.items || [] : [];
    $('#sv-items').innerHTML = items.map((it, i) => it.kind === 'header'
      ? `<div class="item head" data-i="${i}"><span class="t">${esc(it.title || 'Section')}</span><button class="btn sm ghost x" data-del="${i}" title="Remove">✕</button></div>`
      : `<div class="item ${sel && sel.item === it.id ? 'sel' : ''} ${live && live.service === serviceId && live.item === it.id && live.index >= 0 ? 'live' : ''}" data-item="${esc(it.id)}">
          <span class="k" style="background:${KIND[it.kind] ? KIND[it.kind][0] : '#666'}"></span><span class="t">${esc(itemTitle(it))}<small>${esc(KIND[it.kind] ? KIND[it.kind][1] : '')}${it.kind === 'scripture' && it.bibleName ? ' · ' + esc(it.bibleName) : ''}</small></span>
          <button class="btn sm ghost x" data-up="${i}" title="Move up">↑</button><button class="btn sm ghost x" data-down="${i}" title="Move down">↓</button><button class="btn sm ghost x" data-del="${i}" title="Remove from the service">✕</button></div>`).join('')
      || `<div class="muted small">${sv ? 'Empty. Add songs, scripture, text or media from the library below.' : 'Create a service to build an order of service, or show items straight from the library.'}</div>`;
  }
  $('#sv-pick').onchange = e => { serviceId = e.target.value; store.set('w.service', serviceId); sel = null; renderAll(); };
  $('#sv-new').onclick = async () => {
    if (!canEdit()) return toast('You need the Producer role to create a service', 'err');
    const r = await modal('New service', `<label class="f"><span>Name</span><input type="text" name="name" value="Sunday service" autofocus></label><label class="f"><span>Date</span><input type="text" name="date" value="${new Date().toLocaleDateString('en-CA')}" placeholder="YYYY-MM-DD"></label>`, 'Create');
    if (!r || !r.name) return;
    try { const id = newId('service'); const d = await api('PUT', `/api/docs/service/${id}?team=${encodeURIComponent(team)}`, { data: { name: r.name, date: r.date || '', items: [] } }); docs.set(id, d.doc); serviceId = id; store.set('w.service', id); renderAll(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#sv-head').onclick = async () => { const r = await modal('Heading', '<label class="f"><span>Heading in the order of service</span><input type="text" name="title" placeholder="Worship, Sermon, Announcements…" autofocus></label>', 'Add'); if (r && r.title) addItem({ kind: 'header', title: r.title }); };
  $('#sv-items').addEventListener('click', e => {
    const b = e.target.closest('[data-up],[data-down],[data-del]');
    if (b) {
      e.stopPropagation();
      const i = +(b.dataset.up || b.dataset.down || b.dataset.del);
      return saveService(d => { if (b.dataset.del !== undefined) d.items.splice(i, 1); else { const j = b.dataset.up !== undefined ? i - 1 : i + 1; if (j < 0 || j >= d.items.length) return false; [d.items[i], d.items[j]] = [d.items[j], d.items[i]]; } });
    }
    const it = e.target.closest('[data-item]');
    if (it) { sel = { item: it.dataset.item }; renderAll(); }
  });

  // ------------------------------------------------------------------------------------------ left: library
  $$('#lib-tabs .tab').forEach(t => t.onclick = () => { lib = t.dataset.lib; store.set('w.lib', lib); q = ''; passage = null; renderLib(); });
  function renderLib() {
    $$('#lib-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.lib === lib));
    const root = $('#lib');
    if (lib === 'songs') {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const songs = list('song').filter(s => { const hay = [s.data.title, s.data.author, s.data.ccliNumber, s.data.lyrics].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); })
        .sort((a, b) => String(a.data.title).localeCompare(String(b.data.title))).slice(0, 60);
      root.innerHTML = `<input type="text" id="lib-q" placeholder="Search title, words, writer or CCLI number" value="${esc(q)}">
        <div style="margin-top:6px">${songs.map(s => `<div class="res" data-song="${esc(s.id)}"><span class="t"><b>${esc(s.data.title)}</b><small>${esc([s.data.author, s.data.ccliNumber ? 'CCLI ' + s.data.ccliNumber : ''].filter(Boolean).join(' · '))}</small></span><button class="btn sm" data-add="${esc(s.id)}" title="Add to the service">+</button></div>`).join('')
          || '<div class="muted small" style="padding:6px">No songs found.</div>'}</div>
        <div class="row" style="margin-top:8px"><a class="btn sm" href="/#/edit/song/new" target="_blank">New song</a><a class="btn sm" href="/#/list/song" target="_blank">Import from SongSelect…</a></div>`;
      const inp = $('#lib-q'); inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; renderLib(); const n = $('#lib-q'); n.focus(); n.setSelectionRange(pos, pos); };
      $$('[data-song]', root).forEach(r => r.onclick = e => { if (e.target.closest('[data-add]')) return; sel = { song: r.dataset.song }; renderAll(); });
      $$('[data-add]', root).forEach(b => b.onclick = () => addItem({ kind: 'song', song: b.dataset.add }));
    } else if (lib === 'scripture') {
      const cur = store.get('w.bible', (bibles[0] || {}).id || '');
      root.innerHTML = bibles.length ? `<select id="bib">${bibles.map(b => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <div class="row" style="margin-top:6px;flex-wrap:nowrap"><input type="text" id="ref" placeholder="John 3:16-18 · Ps 23 · 1 Kor 13:4-7" value="${esc(q)}"><button class="btn sm primary" id="ref-go">Find</button></div>
        <div class="small muted" style="margin-top:4px">Type a reference, or words to search for.</div><div id="pas" style="margin-top:8px"></div>`
        : `<div class="muted small">No Bible on this PC yet.</div><div class="row" style="margin-top:8px"><a class="btn sm primary" href="/#/bibles" target="_blank">Add a Bible…</a></div>`;
      if (!bibles.length) return;
      $('#bib').onchange = e => store.set('w.bible', e.target.value);
      const find = async () => {
        q = $('#ref').value.trim(); if (!q) return;
        const bible = $('#bib').value;
        try {
          if (Worship.parseRef(q)) passage = await api('GET', `/worship/api/passage?bible=${encodeURIComponent(bible)}&ref=${encodeURIComponent(q)}`);
          else { const r = await api('GET', `/worship/api/search?bible=${encodeURIComponent(bible)}&q=${encodeURIComponent(q)}`); passage = { results: r.results }; }
        } catch (e) { passage = null; toast(e.message, 'err'); }
        paintPassage();
      };
      const paintPassage = () => {
        const box = $('#pas'); if (!box) return;
        if (!passage) { box.innerHTML = ''; return; }
        if (passage.results) { box.innerHTML = passage.results.map(r => `<div class="res" data-ref="${esc(r.ref)}"><span class="t"><b>${esc(r.ref)}</b><small style="white-space:normal">${esc(r.text)}</small></span></div>`).join('') || '<div class="muted small">Nothing found.</div>'; $$('[data-ref]', box).forEach(r => r.onclick = () => { $('#ref').value = r.dataset.ref; find(); }); return; }
        box.innerHTML = `<b>${esc(passage.ref)}</b> <span class="muted small">${esc(passage.bibleName)} · ${passage.verses.length} verses</span>
          <div class="row" style="margin-top:6px"><button class="btn sm" id="pas-view">View slides</button><button class="btn sm primary" id="pas-add">+ Add to service</button></div>`;
        const item = () => ({ kind: 'scripture', ref: passage.ref, bible: passage.bible, bibleName: passage.bibleName, text: passage.text });
        $('#pas-view').onclick = () => { sel = { adhoc: item() }; renderAll(); };
        $('#pas-add').onclick = () => addItem(item());
      };
      $('#ref-go').onclick = find; $('#ref').onkeydown = e => { if (e.key === 'Enter') find(); };
      paintPassage();
    } else if (lib === 'text') {
      root.innerHTML = `<input type="text" id="tx-title" placeholder="Title (announcements, sermon points…)">
        <textarea id="tx-body" rows="7" style="margin-top:6px" placeholder="One slide per paragraph.&#10;Leave a blank line between slides."></textarea>
        <div class="row" style="margin-top:6px"><button class="btn sm" id="tx-view">View slides</button><button class="btn sm primary" id="tx-add">+ Add to service</button></div>`;
      const item = () => ({ kind: 'text', title: $('#tx-title').value.trim(), text: $('#tx-body').value });
      $('#tx-view').onclick = () => { if ($('#tx-body').value.trim()) { sel = { adhoc: item() }; renderAll(); } };
      $('#tx-add').onclick = () => { if ($('#tx-body').value.trim()) { addItem(item()); $('#tx-body').value = ''; $('#tx-title').value = ''; } };
    } else {
      const imgs = list('image').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
      root.innerHTML = `<div class="thumbs">${imgs.map(i => `<img src="/media/${esc(i.id)}" data-img="${esc(i.id)}" title="${esc(i.data.name || '')} – click to add" alt="${esc(i.data.name || '')}" loading="lazy">`).join('')}</div>
        ${imgs.length ? '' : '<div class="muted small">No images yet. Upload them under Images in RFP Manager.</div>'}
        <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input type="text" id="clip" placeholder="CasparCG video clip name"><button class="btn sm" id="clip-add">+ Clip</button></div>`;
      $$('[data-img]', root).forEach(i => i.onclick = () => addItem({ kind: 'media', title: (data(i.dataset.img) || {}).name || 'Image', image: i.dataset.img }));
      $('#clip-add').onclick = () => { const c = $('#clip').value.trim(); if (c) addItem({ kind: 'media', title: c, clip: c }); };
    }
  }

  // ------------------------------------------------------------------------------------------ middle: the slides of the selected item
  function selected() {
    if (!sel) return null;
    if (sel.item) { const sv = service(), it = sv && (sv.data.items || []).find(x => x.id === sel.item); return it ? { item: it, target: { service: serviceId, item: it.id }, isLive: !!live && live.service === serviceId && live.item === it.id } : null; }
    if (sel.song) return { item: { kind: 'song', song: sel.song }, target: { song: sel.song }, isLive: !!live && !live.item && live.song === sel.song };
    if (sel.adhoc) return { item: sel.adhoc, target: { adhoc: sel.adhoc }, isLive: !!live && !live.item && !live.song && live.title === (sel.adhoc.title || sel.adhoc.ref || '') };
    return null;
  }
  function renderDeck() {
    const root = $('#deck'), s = selected();
    if (!s) { root.innerHTML = `<div class="panel"><h4>Slides</h4><p class="muted">Choose an item in the service, or a song in the library, to see its slides. Click a slide to put it on screen.</p>
      <p class="muted small">Keys: <span class="kbd">→</span> / <span class="kbd">Space</span> next · <span class="kbd">←</span> previous · <span class="kbd">F1</span> clear all · <span class="kbd">F2</span> clear slide · <span class="kbd">F3</span> blank · <span class="kbd">F4</span> logo · <span class="kbd">F5</span> clear name</p></div>`; return; }
    const slides = Worship.itemSlides(s.item, ctx()), song = s.item.kind === 'song' ? data(s.item.song) : null, look = wset().look || {};
    const bg = look.backgroundImage ? `background-image:url(/media/${esc(look.backgroundImage)});` : `background:${esc(look.background || '#000')};`;
    root.innerHTML = `<div class="row" style="margin-bottom:10px"><h3 style="margin:0">${esc(itemTitle(s.item))}</h3>
        <span class="muted small">${song ? esc([song.author, song.ccliNumber ? 'CCLI ' + song.ccliNumber : 'no CCLI number'].filter(Boolean).join(' · ')) : esc(s.item.bibleName || '')}</span><span class="grow"></span>
        ${song ? `<a class="btn sm" href="/#/edit/song/${esc(s.item.song)}" target="_blank">Edit song</a>` : ''}
        ${(s.item.kind === 'text' || s.item.kind === 'scripture') && s.target.item ? '<button class="btn sm" id="it-edit">Edit text</button>' : ''}
        ${!s.target.item && service() ? '<button class="btn sm primary" id="it-add">+ Add to service</button>' : ''}</div>
      <div class="grid-slides">${slides.map((sl, i) => `<div class="slide ${s.isLive && live.index === i && !live.blank && !live.logo ? 'live' : ''} ${s.isLive && live.index + 1 === i ? 'next' : ''}" data-go="${i}">
          <div class="body" style="${sl.kind === 'media' && sl.image ? `background-image:url(/media/${esc(sl.image)})` : bg}color:${esc(look.textColor || '#fff')}">${esc(sl.kind === 'media' ? (sl.image ? '' : '▶ ' + (sl.clip || '')) : (look.uppercase ? sl.lines.join('\n').toUpperCase() : sl.lines.join('\n')))}</div>
          ${sl.footer ? `<div class="foot">${esc(sl.footer)}</div>` : ''}
          <div class="lbl" style="background:${esc(sl.colour || '#4b5563')}"><span>${esc(sl.label || '')}</span><b>${i + 1}</b></div></div>`).join('')}</div>
      ${slides.length ? '' : '<div class="banner warn"><span class="grow">This item has no slides yet.</span></div>'}`;
    $$('[data-go]', root).forEach(el => el.onclick = () => act('go', Object.assign({ index: +el.dataset.go }, s.target)));
    const ed = $('#it-edit'); if (ed) ed.onclick = async () => {
      const r = await modal('Edit slides', `<label class="f"><span>Title</span><input type="text" name="title" value="${esc(s.item.title || s.item.ref || '')}"></label>
        <label class="f"><span>Slides (blank line = new slide, "# Label" on the first line of a slide names it)</span><textarea name="text" rows="14">${esc(s.item.text || '')}</textarea></label>`, 'Save', true);
      if (r) saveService(d => { const it = d.items.find(x => x.id === s.item.id); if (!it) return false; it.text = r.text; if (it.kind === 'text') it.title = r.title; else it.ref = r.title; });
    };
    const ad = $('#it-add'); if (ad) ad.onclick = () => addItem(s.item);
  }

  // ------------------------------------------------------------------------------------------ right: live, names, stage, buttons, settings
  function setLive(s) {
    if (!s || (live && s.rev < live.rev)) return;
    if (!s._at) s._at = Date.now();
    live = s;
    renderLive(); renderService(); renderDeck();
    if (side === 'stage') paintTimer();
  }
  function renderLive() {
    if (!live) return;
    $('#liveline').innerHTML = live.logo ? 'LOGO' : live.blank ? 'BLANK' : live.slide ? `${esc(live.title)}<span class="sub">${esc(live.slide.label || '')} · slide ${live.index + 1} of ${live.count}</span>` : '<span class="sub">Nothing on screen</span>';
    $('#live-pos').textContent = live.index >= 0 ? `${live.index + 1} / ${live.count}` : '';
    $('#next').textContent = live.next ? (live.next.lines || []).join('\n') || live.next.label || '' : live.index >= 0 ? 'End of this item' : '';
    $('#c-blank').classList.toggle('on', !!live.blank); $('#c-logo').classList.toggle('on', !!live.logo);
    const c = live.caspar, pc = $('#pill-caspar');
    pc.textContent = !live.local ? 'NOT ON PRODUCTION PC' : c && c.settings && c.settings.enabled === false ? 'BROWSER OUTPUT' : c && c.connected ? 'CASPAR OK' : 'CASPAR OFFLINE';
    pc.className = 'pill ' + (!live.local ? 'bad' : c && c.connected ? 'ok' : 'warn');
  }
  $$('#side-tabs .tab').forEach(t => t.onclick = () => { side = t.dataset.side; store.set('w.side', side); renderSide(); });
  let timerTick = null;
  function paintTimer() {
    const el = $('#tm-left'); if (!el || !live) return;
    const t = live.timer, ms = t.running ? Math.max(0, t.endsAt - (Date.now() + (live.now - live._at))) : t.leftMs || 0, s = Math.round(ms / 1000);
    el.textContent = `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  function renderSide() {
    $$('#side-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.side === side));
    const root = $('#side'); clearInterval(timerTick);
    $('.wmain').classList.toggle('wide', side === 'settings');
    if (side === 'names') {
      const people = wset().people || [];
      root.innerHTML = `<label class="f"><span>Name</span><input type="text" id="lt1" value="${esc(live && live.lt ? live.lt.line1 : '')}"></label>
        <label class="f" style="margin-top:6px"><span>Title</span><input type="text" id="lt2" value="${esc(live && live.lt ? live.lt.line2 : '')}"></label>
        <div class="row" style="margin-top:8px"><button class="btn danger" id="lt-show">Show name</button><button class="btn" id="lt-hide">Hide</button><span class="grow"></span>${canEdit() ? '<button class="btn sm" id="lt-save" title="Keep this name for next time">Save</button>' : ''}</div>
        <div style="margin-top:10px">${people.map((p, i) => `<div class="res" data-p="${i}"><span class="t"><b>${esc(p.name)}</b><small>${esc(p.title || '')}</small></span>${role === 'Admin' ? `<button class="btn sm ghost" data-pdel="${i}">✕</button>` : ''}</div>`).join('') || '<div class="muted small">Saved speakers, pastors and worship leaders appear here.</div>'}</div>`;
      const show = () => act('lt', { line1: $('#lt1').value, line2: $('#lt2').value });
      $('#lt-show').onclick = show; $('#lt-hide').onclick = () => act('lt', { on: false });
      $$('[data-p]', root).forEach(r => r.onclick = e => { if (e.target.closest('[data-pdel]')) return; const p = people[+r.dataset.p]; $('#lt1').value = p.name; $('#lt2').value = p.title || ''; });
      r2(root, '[data-p]', 'dblclick', show);
      const sv = $('#lt-save'); if (sv) sv.onclick = () => saveOrg(w => { w.people = (w.people || []).filter(p => p.name !== $('#lt1').value.trim()).concat([{ name: $('#lt1').value.trim(), title: $('#lt2').value.trim() }]).filter(p => p.name); });
      $$('[data-pdel]', root).forEach(b => b.onclick = () => saveOrg(w => { w.people = (w.people || []).filter((_, i) => i !== +b.dataset.pdel); }));
    } else if (side === 'stage') {
      root.innerHTML = `<label class="f"><span>Message to the stage</span><input type="text" id="msg" value="${esc(live ? live.message : '')}" placeholder="Wrap up · 2 minutes · Child pick-up"></label>
        <div class="row" style="margin-top:6px"><button class="btn primary" id="msg-send">Send</button><button class="btn" id="msg-clear">Clear</button></div>
        <hr><div class="row"><b style="font-size:26px;font-variant-numeric:tabular-nums" id="tm-left">00:00</b><span class="muted small">${esc(live && live.timer.label || 'Timer')}</span></div>
        <div class="form-grid" style="margin-top:6px"><label class="f"><span>Label</span><input type="text" id="tm-label" value="${esc(live ? live.timer.label : '')}" placeholder="Sermon"></label>
          <label class="f"><span>Minutes</span><input type="number" id="tm-min" value="30" min="0"></label><label class="f"><span>or count down to (HH:MM)</span><input type="text" id="tm-to" placeholder="10:30"></label></div>
        <div class="row" style="margin-top:8px"><button class="btn go" id="tm-start">Start</button><button class="btn" id="tm-pause">Pause</button><button class="btn" id="tm-resume">Resume</button><button class="btn" id="tm-reset">Reset</button></div>
        <p class="small muted" style="margin-top:10px">The stage display shows the current and next slide, the clock, this timer and your message. Open it from STAGE ↗ on the screen facing the platform.</p>`;
      $('#msg-send').onclick = () => act('message', { text: $('#msg').value }); $('#msg-clear').onclick = () => { $('#msg').value = ''; act('message', { text: '' }); };
      $('#msg').onkeydown = e => { if (e.key === 'Enter') act('message', { text: $('#msg').value }); };
      $('#tm-start').onclick = () => act('timer', $('#tm-to').value.trim() ? { op: 'start', to: $('#tm-to').value.trim(), label: $('#tm-label').value } : { op: 'start', seconds: (+$('#tm-min').value || 0) * 60, label: $('#tm-label').value });
      $('#tm-pause').onclick = () => act('timer', { op: 'pause' }); $('#tm-resume').onclick = () => act('timer', { op: 'start' }); $('#tm-reset').onclick = () => act('timer', { op: 'reset' });
      paintTimer(); timerTick = setInterval(paintTimer, 250);
    } else if (side === 'macros') {
      const ms = live ? live.macros : [];
      root.innerHTML = `<div class="row">${ms.map(m => `<button class="btn macro" data-m="${esc(m.id)}" style="${m.color ? `border-color:${esc(m.color)};box-shadow:inset 0 -3px 0 ${esc(m.color)}` : ''}">${esc(m.name)}</button>`).join('')}</div>
        ${ms.length ? '' : '<div class="muted small">Your own CasparCG buttons: play a sting, fire a lower third from another template, switch a background. Add them under Settings.</div>'}`;
      $$('[data-m]', root).forEach(b => b.onclick = () => act('macro', { id: b.dataset.m }).then(s => { if (s) toast('Sent', 'ok'); }));
    } else renderSettings(root);
  }
  const r2 = (root, sel2, ev, fn) => $$(sel2, root).forEach(el => el.addEventListener(ev, fn));

  async function saveOrg(mutate) {
    if (role !== 'Admin') return toast('Only an Admin can change the team\'s worship settings', 'err');
    const d = JSON.parse(JSON.stringify(org())); d.worship = d.worship || {};
    mutate(d.worship);
    try { const r = await api('PUT', `/api/docs/org/${team}?team=${encodeURIComponent(team)}`, { data: d }); docs.set(team, r.doc); renderAll(); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
  }
  async function renderSettings(root) {
    const L = Object.assign({ font: 'Segoe UI', textColor: '#ffffff', background: '#000000', backgroundImage: '', align: 'center', uppercase: false, linesPerSlide: 4, size: 100, lowerColor: '#000000', lowerOpacity: 70, lowerLines: 2, showCopyright: true, showLabel: false }, wset().look || {});
    if (macrosFull === null && canEdit() && live && live.local) { try { macrosFull = (await api('GET', '/worship/api/macros')).macros; } catch (e) { macrosFull = []; } }
    const outs = live ? live.outputs : [], lt = live ? live.lowerThird : { channel: 0, layer: 62, template: 'worship' }, imgs = list('image');
    root.innerHTML = `<h4>Look ${role === 'Admin' ? '' : '<span class="small muted">(Admin only)</span>'}</h4>
      <div class="form-grid" id="look">
        <label class="f"><span>CCLI licence number</span><input type="text" data-w="ccliLicence" value="${esc(wset().ccliLicence || '')}"></label>
        <label class="f"><span>CCLI streaming licence</span><input type="text" data-w="ccliStreamLicence" value="${esc(wset().ccliStreamLicence || '')}"></label>
        <label class="f"><span>Font</span><input type="text" data-l="font" value="${esc(L.font)}"></label>
        <label class="f"><span>Text size %</span><input type="number" data-l="size" value="${esc(L.size)}" min="40" max="200"></label>
        <label class="f"><span>Lines per slide</span><input type="number" data-l="linesPerSlide" value="${esc(L.linesPerSlide)}" min="1" max="12"></label>
        <label class="f"><span>Align</span><select data-l="align">${['left', 'center', 'right'].map(a => `<option ${L.align === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="f"><span>Text colour</span><input type="color" data-l="textColor" value="${esc(L.textColor)}"></label>
        <label class="f"><span>Background colour</span><input type="color" data-l="background" value="${esc(L.background)}"></label>
        <label class="f"><span>Background image</span><select data-l="backgroundImage"><option value="">None</option>${imgs.map(i => `<option value="${esc(i.id)}" ${L.backgroundImage === i.id ? 'selected' : ''}>${esc(i.data.name || i.id)}</option>`).join('')}</select></label>
        <label class="f"><span>Lower third colour</span><input type="color" data-l="lowerColor" value="${esc(L.lowerColor)}"></label>
        <label class="f"><span>Lower third opacity %</span><input type="number" data-l="lowerOpacity" value="${esc(L.lowerOpacity)}" min="0" max="100"></label>
        <label class="f"><span>Lower third lines</span><input type="number" data-l="lowerLines" value="${esc(L.lowerLines)}" min="1" max="4"></label>
        <label class="chk"><input type="checkbox" data-l="uppercase" ${L.uppercase ? 'checked' : ''}> UPPERCASE</label>
        <label class="chk"><input type="checkbox" data-l="showCopyright" ${L.showCopyright !== false ? 'checked' : ''}> Copyright + CCLI line on songs</label>
        <label class="chk"><input type="checkbox" data-l="showLabel" ${L.showLabel ? 'checked' : ''}> Show "Verse 1" on screen</label>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="look-save" ${role === 'Admin' ? '' : 'disabled'}>Save look</button></div>
      <hr><h4>CasparCG outputs ${canEdit() ? '' : '<span class="small muted">(Producer or Admin)</span>'}</h4>
      <p class="small muted">Channel 0 = the program channel. Use another channel for a keyed stream feed. Your own template can replace <span class="mono">worship</span>.</p>
      <table class="t cfg" id="outs"><tr><th>On</th><th>Name</th><th>Ch</th><th>Layer</th><th>Template</th><th>Shows</th><th></th></tr>
        ${outs.map((o, i) => `<tr data-o="${i}"><td><input type="checkbox" data-k="enabled" ${o.enabled ? 'checked' : ''}></td><td><input type="text" data-k="name" value="${esc(o.name)}"></td><td><input type="number" data-k="channel" value="${o.channel}" style="width:54px" min="0"></td>
          <td><input type="number" data-k="layer" value="${o.layer}" style="width:60px" min="1"></td><td><input type="text" data-k="template" value="${esc(o.template)}" style="width:90px"></td>
          <td><select data-k="layout"><option value="full" ${o.layout !== 'lower' ? 'selected' : ''}>Full slides</option><option value="lower" ${o.layout === 'lower' ? 'selected' : ''}>Lower third</option></select></td><td><button class="btn sm ghost" data-odel="${i}">✕</button></td></tr>`).join('')}
        <tr><td></td><td><b>Name super</b></td><td><input type="number" id="lt-ch" value="${lt.channel}" style="width:54px" min="0"></td><td><input type="number" id="lt-layer" value="${lt.layer}" style="width:60px" min="1"></td><td><input type="text" id="lt-tpl" value="${esc(lt.template)}" style="width:90px"></td><td class="muted small">Names tab</td><td></td></tr></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="out-add">+ Output</button></div>
      <h4 style="margin-top:12px">Your buttons (AMCP commands)</h4>
      <div id="macs">${(macrosFull || []).map((m, i) => `<div class="panel" data-mc="${i}" style="padding:8px;margin-bottom:6px"><div class="row" style="flex-wrap:nowrap"><input type="text" data-k="name" value="${esc(m.name)}" placeholder="Button name"><input type="color" data-k="color" value="${esc(m.color || '#3d3d3d')}"><button class="btn sm ghost" data-mdel="${i}">✕</button></div>
        <textarea data-k="commands" rows="3" style="margin-top:6px" placeholder='One AMCP command per line, e.g.&#10;PLAY 1-10 "STING" MIX 10&#10;CG 1-25 ADD 1 "mytheme/lowerthird" 1 "{\\"line1\\":\\"Welcome\\"}"'>${esc(m.commands || '')}</textarea></div>`).join('')}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="mac-add">+ Button</button><span class="grow"></span><button class="btn primary" id="out-save" ${canEdit() && live && live.local ? '' : 'disabled'}>Save outputs and buttons</button></div>`;
    $('#look-save').onclick = () => saveOrg(w => {
      w.look = w.look || {};
      $$('[data-l]', root).forEach(el => { w.look[el.dataset.l] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; });
      $$('[data-w]', root).forEach(el => { w[el.dataset.w] = el.value.trim(); });
    });
    const collect = () => ({
      outputs: $$('[data-o]', root).map((tr, i) => { const o = { id: (outs[i] || {}).id || 'out' + (i + 1) }; $$('[data-k]', tr).forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; }); return o; }),
      lowerThird: { channel: +$('#lt-ch').value, layer: +$('#lt-layer').value, template: $('#lt-tpl').value },
      macros: $$('[data-mc]', root).map((p, i) => { const m = { id: ((macrosFull || [])[i] || {}).id || 'm' + Date.now() + i }; $$('[data-k]', p).forEach(el => { m[el.dataset.k] = el.value; }); if (m.color === '#3d3d3d') m.color = ''; return m; }),
    });
    const repaint = c => { live.outputs = c.outputs; live.lowerThird = c.lowerThird; macrosFull = c.macros; renderSettings(root); };
    $('#out-add').onclick = () => { const c = collect(); c.outputs.push({ id: 'out' + Date.now().toString(36), name: 'Output ' + (c.outputs.length + 1), enabled: false, channel: 0, layer: 63 + c.outputs.length, template: 'worship', layout: 'full' }); repaint(c); };
    $$('[data-odel]', root).forEach(b => b.onclick = () => { const c = collect(); c.outputs.splice(+b.dataset.odel, 1); repaint(c); });
    $('#mac-add').onclick = () => { const c = collect(); c.macros.push({ id: 'm' + Date.now().toString(36), name: 'New button', color: '', commands: '' }); repaint(c); };
    $$('[data-mdel]', root).forEach(b => b.onclick = () => { const c = collect(); c.macros.splice(+b.dataset.mdel, 1); repaint(c); });
    $('#out-save').onclick = async () => { try { const s = await api('POST', '/worship/api/settings', collect()); macrosFull = s.macrosFull; setLive(s); renderSettings(root); toast('Outputs saved', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  }

  // ------------------------------------------------------------------------------------------ modal, keys, start
  function modal(title, body, ok, wide) {
    return new Promise(resolve => {
      const back = h(`<div class="modal-back"><form class="modal" style="${wide ? 'width:min(760px,96vw)' : ''}" autocomplete="off"><h3>${esc(title)}</h3><div class="stack">${body}</div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">${esc(ok || 'OK')}</button></div></form></div>`);
      const done = v => { back.remove(); resolve(v); };
      back.querySelector('form').onsubmit = e => { e.preventDefault(); const o = {}; new FormData(e.target).forEach((v, k) => { o[k] = v; }); done(o); };
      back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-cancel]')) done(null); });
      back.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); e.stopPropagation(); });
      document.body.appendChild(back);
      const f = back.querySelector('[autofocus]'); if (f) f.focus();
    });
  }
  $('#c-all').onclick = () => act('clear', { what: 'all' });
  $('#c-slide').onclick = () => act('clear', { what: 'slide' });
  $('#c-blank').onclick = () => act('blank');
  $('#c-logo').onclick = () => act('logo');
  $('#c-lt').onclick = () => act('lt', { on: false });
  $('#b-next').onclick = () => act('next'); $('#b-prev').onclick = () => act('prev');
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { ArrowRight: () => act('next'), ' ': () => act('next'), PageDown: () => act('next'), ArrowDown: () => act('next'), ArrowLeft: () => act('prev'), PageUp: () => act('prev'), ArrowUp: () => act('prev'),
      F1: () => act('clear', { what: 'all' }), F2: () => act('clear', { what: 'slide' }), F3: () => act('blank'), b: () => act('blank'), B: () => act('blank'), F4: () => act('logo'), F5: () => act('lt', { on: false }) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  });

  function renderAll() { renderService(); renderLib(); renderDeck(); renderSide(); renderLive(); }
  function wall(msg, link, label) {
    document.body.innerHTML = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px"><div><h2 style="margin:0 0 10px">RFP Manager</h2><p>${esc(msg)}</p><p><a href="${esc(link)}">${esc(label)}</a></p></div></div>`;
  }
  function accent(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return;
    const st = document.documentElement.style, lum = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
    st.setProperty('--accent', hex); st.setProperty('--accent2', hex); st.setProperty('--on-accent', lum > 0.55 ? '#0b0b0b' : '#ffffff');
  }
  async function start() {
    try { me = await api('GET', '/api/me'); } catch (e) { return wall('Sign in to RFP Manager to open worship control.', '/?next=' + encodeURIComponent(location.pathname), 'Sign in'); }
    if (!me.teams.length) return wall('Create a production team in RFP Manager first.', '/', 'Open RFP Manager');
    const want = store.get('rfp.team', '');
    const t = me.teams.find(x => x.id === want) || me.teams[0];
    team = t.id; role = t.role; accent(t.accentColor);
    if (me.machine.outputKey) $('#l-stage').href = 'stage.html?key=' + encodeURIComponent(me.machine.outputKey);
    await loadDocs();
    try { bibles = (await api('GET', '/worship/api/bibles')).bibles; } catch (e) { bibles = []; }
    renderAll();
    $('#mon').src = 'output.html?bg=black';
    const es = new EventSource('/worship/api/events');
    es.onmessage = ev => { const s = JSON.parse(ev.data); s._at = Date.now(); $('#pill-server').className = 'pill ok'; $('#pill-server').textContent = 'SERVER'; setLive(s); };
    es.onerror = () => { $('#pill-server').className = 'pill bad'; };
    setInterval(async () => { if (document.hidden) return; try { await loadDocs(); if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) { renderService(); renderDeck(); } } catch (e) { /* offline */ } }, 15000);
    window.addEventListener('focus', async () => { try { await loadDocs(); bibles = (await api('GET', '/worship/api/bibles')).bibles; if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) renderAll(); } catch (e) { /* offline */ } });
  }
  start();
})();
