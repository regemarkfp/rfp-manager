/* RFP Manager – Timeline: the show on tracks against time (shots, graphics, lyrics, lights, audio, playback, notes).
   Edit view: drag cues, give them actions, sections with their own tempo, comments at a moment.
   Run: PLAY / GO / holds, driven by the production PC so every screen sees the same playhead.
   Crew view (?view=crew): now / next for the tracks a person follows, with countdowns. */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;
  const Q = new URLSearchParams(location.search);
  const narrowHead = window.matchMedia('(max-width: 700px)');
  let HEAD = narrowHead.matches ? 110 : 190;          // width of the track names (smaller on a phone)
  narrowHead.addEventListener('change', () => { HEAD = narrowHead.matches ? 110 : 190; if (doc && mode === 'edit') drawCanvas(); });
  const KIND = { shots: ['Shots', '#4f7aa5'], graphics: ['Graphics', '#2ea043'], lyrics: ['Lyrics', '#9b6fd1'], lights: ['Lights', '#d6a21e'], audio: ['Audio', '#2aa7b0'], playback: ['Playback', '#e0663f'], notes: ['Notes', '#7d8799'], other: ['Other', '#8a94a6'] };
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } } };

  let id = Q.get('id') || '', mode = Q.get('view') === 'crew' ? 'crew' : 'edit';
  let doc = null, can = {}, me = null, follow = false, waiting = false;
  let run = { state: 'stopped', pos: 0, holdId: '' }, recvAt = Date.now();
  let pps = store.get('tl-pps', 40), snapOn = store.get('tl-snap', true), followHead = store.get('tl-follow', true), sideOpen = false;
  let sel = null, dirty = false, lastEdit = 0, saveT = null, undoL = [], redoL = [], clip = null, list = [];
  const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 10);

  // ---------------------------------------------------------------- time
  const pos = () => (run.state === 'playing' ? run.pos + (Date.now() - recvAt) / 1000 : run.pos);
  function fmt(t, tenths) {
    t = Math.max(0, t || 0);
    t += 1e-6;
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60), d = Math.floor((t * 10) % 10);
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0') + (tenths ? '.' + d : '');
  }
  const cd = (t) => (t < 60 ? (Math.max(0, t)).toFixed(t < 10 ? 1 : 0) + 's' : fmt(t));
  function parseT(s) {
    s = String(s || '').trim().replace(',', '.'); if (!s) return 0;
    const p = s.split(':').map(Number); if (p.some((x) => !Number.isFinite(x))) return null;
    return Math.max(0, p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]);
  }
  // tempo: the timeline's BPM from 0, a section with a BPM starts its own grid (bar 1 at the section)
  const segs = () => [{ at: 0, bpm: Number(doc.bpm) || 120, label: '' }, ...(doc.sections || []).filter((s) => s.bpm > 0).map((s) => ({ at: s.at, bpm: s.bpm, label: s.label }))].sort((a, b) => a.at - b.at);
  const segAt = (t) => { const L = segs(); let s = L[0]; for (const x of L) if (x.at <= t + 1e-6) s = x; return s; };
  const bpb = () => Math.max(1, Number(doc.beatsPerBar) || 4);
  function bb(t) { const s = segAt(t), bl = 60 / s.bpm, beats = Math.max(0, (t - s.at) / bl + 1e-6); return `${Math.floor(beats / bpb()) + 1}.${Math.floor(beats % bpb()) + 1}`; }
  const majorStep = () => [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((s) => s * pps >= 70) || 3600;
  const MINOR = { 0.1: 0.05, 0.25: 0.05, 0.5: 0.1, 1: 0.25, 2: 0.5, 5: 1, 10: 2, 15: 5, 30: 5, 60: 10, 120: 30, 300: 60, 600: 120, 1800: 300, 3600: 600 };
  const minorStep = () => MINOR[majorStep()] || majorStep() / 4;
  function snap(t, raw) {
    t = Math.max(0, t);
    if (raw || !snapOn) return Math.round(t * 100) / 100;
    if (doc.units === 'beats') { const s = segAt(t), bl = 60 / s.bpm; return Math.max(0, Math.round((s.at + Math.round((t - s.at) / bl) * bl) * 100) / 100); }
    const st = minorStep(); return Math.round(Math.round(t / st) * st * 100) / 100;
  }
  const stepNudge = () => (doc.units === 'beats' ? 60 / segAt(pos()).bpm : minorStep());

  // ---------------------------------------------------------------- data helpers
  const tracks = () => doc.tracks || (doc.tracks = []);
  const cues = () => doc.cues || (doc.cues = []);
  const secs = () => doc.sections || (doc.sections = []);
  const trackOf = (tid) => tracks().find((t) => t.id === tid);
  const colorOf = (c) => c.color || (trackOf(c.track) && (trackOf(c.track).color || KIND[trackOf(c.track).kind || 'other'][1])) || '#4f7aa5';
  const sorted = () => cues().slice().sort((a, b) => a.at - b.at);
  const len = () => Math.max(10, Number(doc.length) || 600);
  const findSel = () => (!sel ? null : sel.kind === 'cue' ? cues().find((x) => x.id === sel.id) : sel.kind === 'sec' ? secs().find((x) => x.id === sel.id) : sel.kind === 'track' ? trackOf(sel.id) : null);
  const plain = () => { const d = JSON.parse(JSON.stringify(doc)); delete d.comments; return d; };
  function pushUndo() { undoL.push(JSON.stringify(plain())); if (undoL.length > 60) undoL.shift(); redoL = []; }
  function undo(back) {
    const from = back ? redoL : undoL, to = back ? undoL : redoL;
    if (!from.length) return;
    to.push(JSON.stringify(plain()));
    doc = Object.assign(JSON.parse(from.pop()), { comments: doc.comments || [] });
    if (!findSel()) sel = null;
    edited(true); draw();
  }
  function edited(noUndo) {
    if (!can.edit) return;
    dirty = true; lastEdit = Date.now(); savedPill('UNSAVED', 'warn');
    clearTimeout(saveT); saveT = setTimeout(save, 700);
    if (!noUndo) { /* the caller pushed the undo step */ }
  }
  function save() {
    if (!dirty || !doc) return;
    dirty = false; savedPill('SAVING…', '');
    CG.send('tl', 'save', { id, data: plain() }).then(() => { if (!dirty) savedPill('SAVED', 'ok'); }).catch((e) => { dirty = true; savedPill('NOT SAVED', 'bad'); if (e.message !== 'offline') CG.toast(e.message, 'err'); });
  }
  function savedPill(t, k) { const p = $('#tl-saved'); if (p) { p.textContent = t; p.className = 'pill ' + (k || ''); } }
  const runCmd = (cmd, o) => {
    if (!can.run) { CG.toast(can.local === false ? 'The timeline runs on the production PC. Open it there to play it.' : 'You need the Scorer role (or higher) to run the timeline', 'err'); return Promise.resolve(); }
    return CG.send('tl', 'run', Object.assign({ id, cmd }, o || {})).catch((e) => { if (e.message !== 'offline') CG.toast(e.message, 'err'); });
  };

  // ---------------------------------------------------------------- messages
  CG.on('connected', () => { CG.send('tl', 'list', {}).catch(() => { }); if (id || mode === 'crew') openTl(); });
  function openTl() { CG.send('tl', 'open', { id }).catch((e) => { const m = $('#tl-main'); if (m) m.innerHTML = `<div class="tl-empty">${esc(e.message)}</div>`; }); }
  CG.on('tlList', (m) => {
    list = m.list || [];
    const p = $('#tl-pick');
    p.innerHTML = (id ? '' : '<option value="">' + (mode === 'crew' ? 'The timeline that is running' : 'Choose a timeline…') + '</option>') + list.map((x) => `<option value="${esc(x.id)}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}${x.date ? ' · ' + esc(x.date) : ''}</option>`).join('');
    if (!id && !list.length && mode === 'edit') $('#tl-main').innerHTML = '<div class="tl-empty">No timelines yet. Make one in RFP Manager → Live → Timelines, then open it here.</div>';
    else if (!id && mode === 'edit' && list.length) { id = list[0].id; history.replaceState(null, '', '?id=' + encodeURIComponent(id)); openTl(); }
  });
  CG.on('tl', (m) => {
    if (m.waiting) { waiting = true; doc = null; $('#tl-main').innerHTML = '<div class="tl-empty">Waiting for a timeline to start on the production PC…</div>'; return; }
    if (m.id && m.id !== id && !m.doc) return;
    if (m.gone) { CG.toast('This timeline was deleted', 'err'); doc = null; $('#tl-main').innerHTML = '<div class="tl-empty">This timeline was deleted.</div>'; return; }
    if (m.can) { can = m.can; me = m.me; follow = !!m.follow; }
    if (m.run) { run = m.run; recvAt = Date.now(); }
    if (m.doc) {
      const first = !doc || m.id !== id;
      if (m.id) id = m.id;
      const busy = dirty || Date.now() - lastEdit < 1500 || (document.activeElement && document.activeElement.matches && document.activeElement.matches('.tl-insp input, .tl-insp textarea, .tl-insp select'));
      if (first || !busy) { doc = m.doc; if (!findSel()) sel = null; waiting = false; draw(); }
      else { doc.comments = m.doc.comments || []; drawSide(); drawCommentDots(); }
      if (first) { document.title = (doc.name || 'Timeline') + ' – RFP Manager'; const p = $('#tl-pick'); if (p && p.value !== id) p.value = id; }
    }
    if (m.ev && m.ev.fired) flash(m.ev.fired);
    if (m.run) paintTransport();
  });
  function flash(cid) {
    const el = $(`.tl-cue[data-cue="${cid}"]`); if (el) { el.classList.remove('fired'); void el.offsetWidth; el.classList.add('fired'); }
    const cr = $(`[data-crew-cue="${cid}"]`); if (cr) { cr.classList.remove('fired'); void cr.offsetWidth; cr.classList.add('fired'); }
  }

  // ---------------------------------------------------------------- top bar
  $('#tl-play').onclick = () => runCmd(run.state === 'playing' ? 'pause' : 'play');
  $('#tl-go').onclick = () => runCmd('go');
  $('#tl-home').onclick = () => runCmd('stop');
  $('#tl-prev').onclick = () => runCmd('prev');
  $('#tl-pick').onchange = (e) => { id = e.target.value; follow = !id; history.replaceState(null, '', '?' + new URLSearchParams(Object.assign(id ? { id } : {}, mode === 'crew' ? { view: 'crew' } : {}, Q.get('key') ? { key: Q.get('key') } : {}))); doc = null; sel = null; undoL = []; redoL = []; openTl(); };
  $('#tl-mode').onclick = () => { mode = mode === 'crew' ? 'edit' : 'crew'; draw(); };
  function paintTransport() {
    const p = $('#tl-play'); p.textContent = run.state === 'playing' ? '❚❚' : '▶';
    $$('#tl-transport .btn').forEach((b) => { b.disabled = !can.run; b.title = can.run ? b.title : (can.local === false ? 'The timeline runs on the production PC' : 'You need the Scorer role to run the timeline'); });
    const st = $('#tl-state'); st.textContent = run.state === 'held' ? 'HOLD – PRESS GO' : run.state.toUpperCase(); st.className = 'pill ' + (run.state === 'playing' ? 'ok' : run.state === 'held' ? 'held' : '');
    $$('#tl-ph, #tl-phr').forEach((ph) => ph.classList.toggle('held', run.state === 'held'));
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    const main = $('#tl-main');
    $('#tl-mode').textContent = mode === 'crew' ? 'EDIT VIEW' : 'CREW VIEW';
    $('#tl-transport').style.display = mode === 'crew' && !can.run ? 'none' : '';
    $('#tl-saved').style.display = mode === 'crew' ? 'none' : '';
    $('#tl-pick').style.display = list.length ? '' : 'none';
    $('#tl-crewlink').href = 'timeline.html?' + new URLSearchParams(Object.assign({ view: 'crew' }, id ? { id } : {}));
    if (!doc) return;
    paintTransport();
    if (mode === 'crew') { drawCrew(main); return; }
    const sc = $('#tl-scroll'), keep = sc ? [sc.scrollLeft, sc.scrollTop] : null;
    main.innerHTML = '';
    main.appendChild(h(`<div class="tl-bar">
      <label class="small muted">Zoom <input type="range" id="tl-zoom" min="0" max="100" value="${Math.round(Math.log(pps / 2) / Math.log(200) * 100)}"></label>
      <div class="row" style="gap:2px"><button class="btn sm ${doc.units !== 'beats' ? 'on' : ''}" data-units="time">Time</button><button class="btn sm ${doc.units === 'beats' ? 'on' : ''}" data-units="beats">Bars</button></div>
      <label class="chk small"><input type="checkbox" id="tl-snap" ${snapOn ? 'checked' : ''}> Snap</label>
      <label class="chk small"><input type="checkbox" id="tl-follow" ${followHead ? 'checked' : ''}> Follow playhead</label>
      ${can.edit ? `<select id="tl-addtrack" style="width:auto"><option value="">+ Track…</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
      <button class="btn sm" id="tl-addcue" title="A cue at the playhead on the selected track (N)">+ Cue</button>
      <button class="btn sm" id="tl-addsec" title="A section (song, segment, break) at the playhead (M)">+ Section</button>
      <button class="btn sm ghost" id="tl-undo" title="Undo (Ctrl+Z)" ${undoL.length ? '' : 'disabled'}>↶</button><button class="btn sm ghost" id="tl-redo" title="Redo (Ctrl+Y)" ${redoL.length ? '' : 'disabled'}>↷</button>` : '<span class="small muted">View only</span>'}
      <span class="sp"></span>
      <span class="small muted tl-hint">${matchMedia('(pointer: coarse)').matches ? 'Hold a finger on a track to add a cue · drag to move · drag the end to lengthen' : 'Double-click a track to add a cue · drag to move · drag the end to lengthen'}</span>
      <button class="btn sm ${sideOpen ? 'on' : ''}" id="tl-cmts">Comments (${(doc.comments || []).filter((c) => !c.done).length})</button></div>`));
    const body = h(`<div class="tl-body"><div class="tl-scroll" id="tl-scroll"><div class="tl-canvas" id="tl-canvas"></div></div><aside class="tl-side ${sideOpen ? 'open' : ''}" id="tl-side"></aside></div>`);
    main.appendChild(body);
    main.appendChild(h('<div class="tl-insp" id="tl-insp"></div>'));
    drawCanvas(); drawSide(); drawInsp(); wireBar();
    const sc2 = $('#tl-scroll');
    if (keep) { sc2.scrollLeft = keep[0]; sc2.scrollTop = keep[1]; }
    sc2.addEventListener('scroll', () => requestAnimationFrame(drawTicks));
    drawTicks();
  }
  function wireBar() {
    const z = $('#tl-zoom'); z.oninput = () => { const sc = $('#tl-scroll'), mid = (sc.scrollLeft + sc.clientWidth / 2 - HEAD) / pps; pps = Math.min(Math.round(2 * Math.pow(200, z.value / 100) * 100) / 100, 4e6 / len()); store.set('tl-pps', pps); drawCanvas(); sc.scrollLeft = mid * pps + HEAD - sc.clientWidth / 2; drawTicks(); };
    $$('[data-units]').forEach((b) => b.onclick = () => { if (!can.edit) { doc.units = b.dataset.units; draw(); return; } pushUndo(); doc.units = b.dataset.units; edited(); draw(); });
    $('#tl-snap').onchange = (e) => { snapOn = e.target.checked; store.set('tl-snap', snapOn); };
    $('#tl-follow').onchange = (e) => { followHead = e.target.checked; store.set('tl-follow', followHead); };
    $('#tl-cmts').onclick = () => { sideOpen = !sideOpen; $('#tl-side').classList.toggle('open', sideOpen); $('#tl-cmts').classList.toggle('on', sideOpen); };
    const at = $('#tl-addtrack'); if (at) at.onchange = () => { const k = at.value; if (!k) return; addTrack(k); };
    const as = $('#tl-addsec'); if (as) as.onclick = addSection;
    const ac = $('#tl-addcue'); if (ac) ac.onclick = () => { const x = findSel(); const tid = sel && sel.kind === 'track' ? sel.id : x && sel.kind === 'cue' ? x.track : (tracks()[0] || {}).id; if (tid) newCue(tid, snap(pos())); else CG.toast('Add a track first', 'err'); };
    const u = $('#tl-undo'); if (u) u.onclick = () => undo(false);
    const r = $('#tl-redo'); if (r) r.onclick = () => undo(true);
  }
  function addTrack(k) { pushUndo(); const n = tracks().filter((t) => t.kind === k).length; const t = { id: rid('trk'), name: KIND[k][0] + (n ? ' ' + (n + 1) : ''), kind: k, color: '', armed: true, crew: '' }; tracks().push(t); sel = { kind: 'track', id: t.id }; edited(); draw(); }
  function addSection() { pushUndo(); const s = { id: rid('sec'), at: snap(pos()), label: 'Section ' + (secs().length + 1), color: '', bpm: 0 }; secs().push(s); secs().sort((a, b) => a.at - b.at); sel = { kind: 'sec', id: s.id }; edited(); draw(); }

  function drawCanvas() {
    const cv = $('#tl-canvas'); if (!cv) return;
    const W = (len() + 30) * pps, now = pos();
    const rows = [];
    rows.push(`<div class="tl-row ruler"><div class="tl-head">${doc.units === 'beats' ? 'BAR' : 'TIME'}</div><div class="tl-lane tl-ruler" id="tl-ruler" style="width:${W}px"><div id="tl-ticks"></div><div id="tl-cdots"></div><div class="tl-ph" id="tl-phr" style="z-index:3"></div></div></div>`);
    const S = secs().slice().sort((a, b) => a.at - b.at);
    rows.push(`<div class="tl-row secs"><div class="tl-head" title="Sections: songs, segments, breaks. Double-click the strip to add one.">Sections</div><div class="tl-lane" id="tl-secs" style="width:${W}px">${S.map((s, i) => {
      const end = i + 1 < S.length ? S[i + 1].at : len(), c = s.color || '#8892a6';
      return `<div class="tl-sec ${sel && sel.kind === 'sec' && sel.id === s.id ? 'sel' : ''}" data-sec="${esc(s.id)}" style="left:${s.at * pps}px;width:${Math.max(14, (end - s.at) * pps - 2)}px;border-left-color:${c};background:color-mix(in srgb, ${c} 28%, #2a2d33)" title="${esc(s.label)} · ${fmt(s.at, true)}${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}">${esc(s.label)}${s.bpm ? ` <span class="muted">${s.bpm}</span>` : ''}</div>`;
    }).join('')}</div></div>`);
    if (!tracks().length) rows.push(`<div class="tl-row"><div class="tl-head muted">No tracks</div><div class="tl-lane" style="width:${W}px;padding:12px;color:var(--muted)">${can.edit ? 'Add a track: ' + ['shots', 'graphics', 'lyrics', 'lights', 'audio', 'playback'].map((k) => `<button class="btn sm" data-qt="${k}">${KIND[k][0]}</button>`).join(' ') : 'No tracks yet.'}</div></div>`);
    for (const t of tracks()) {
      const tc = t.color || KIND[t.kind || 'other'][1], ht = t.kind === 'lyrics' ? 58 : 46;
      const mine = cues().filter((c) => c.track === t.id);
      rows.push(`<div class="tl-row ${t.armed ? '' : 'off'}" data-track="${esc(t.id)}" style="height:${ht}px"><div class="tl-head ${sel && sel.kind === 'track' && sel.id === t.id ? 'sel' : ''}" data-head="${esc(t.id)}"><span class="sw" style="background:${tc}"></span><span class="nm" title="${esc(t.name)}${t.crew ? ' · ' + esc(t.crew) : ''}">${esc(t.name)}</span><button class="arm ${t.armed ? 'on' : ''}" data-arm="${esc(t.id)}" title="${t.armed ? 'Armed: its cues fire when the timeline runs. Click to switch off.' : 'Off: its cues show but do not fire. Click to arm.'}">●</button></div>
        <div class="tl-lane" data-lane="${esc(t.id)}" style="width:${W}px">${mine.map((c) => cueHtml(c, now)).join('')}</div></div>`);
    }
    rows.push(`<div class="tl-row" style="border:0;height:60px"><div class="tl-head" style="background:transparent;border:0"></div></div>`);
    cv.style.width = (W + HEAD) + 'px';
    cv.innerHTML = `<div id="tl-grid" style="position:absolute;left:${HEAD}px;top:54px;bottom:0;width:${W}px;pointer-events:none"></div>` + rows.join('') + `<div class="tl-ph" id="tl-ph"></div>`;
    $$('[data-qt]', cv).forEach((b) => b.onclick = () => addTrack(b.dataset.qt));
    drawCommentDots(); drawTicks(); tickFrame(true);
  }
  function cueHtml(c, now) {
    const col = colorOf(c), inst = !(c.dur > 0), w = inst ? Math.max(12, Math.min(160, (c.label || '').length * 7 + 14)) : Math.max(10, c.dur * pps);
    const cls = ['tl-cue', inst ? 'inst' : '', c.kind === 'hold' ? 'hold' : '', (c.actions || []).length ? 'acts' : '', sel && sel.kind === 'cue' && sel.id === c.id ? 'sel' : '', run.state !== 'stopped' && (c.at + (c.dur || 0)) < now ? 'done' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-cue="${esc(c.id)}" style="left:${c.at * pps}px;width:${w}px;background:color-mix(in srgb, ${col} 45%, #1f2329);border-color:${col};color:${col}" title="${esc(c.label)} · ${fmt(c.at, true)}${c.dur ? ' – ' + fmt(c.at + c.dur, true) : ''}${c.kind === 'hold' ? ' · HOLD (waits for GO)' : ''}${(c.actions || []).length ? ' · ' + c.actions.length + ' action(s)' : ''}"><b style="color:var(--text)">${esc(c.label || '·')}</b>${c.text ? `<i>${esc(c.text.split('\n')[0])}</i>` : ''}${can.edit && !inst ? '<span class="rz"></span>' : ''}</div>`;
  }
  function drawTicks() {
    const sc = $('#tl-scroll'), box = $('#tl-ticks'), grid = $('#tl-grid'); if (!sc || !box) return;
    const x0 = Math.max(0, sc.scrollLeft - HEAD - 200) / pps, x1 = (sc.scrollLeft + sc.clientWidth + 200) / pps;
    const T = [], G = [];
    if (doc.units === 'beats') {
      const L = segs();
      L.forEach((s, i) => {
        const end = Math.min(i + 1 < L.length ? L[i + 1].at : len() + 30, x1), bl = 60 / s.bpm, bar = bl * bpb();
        if (end < x0) return;
        const every = Math.pow(2, Math.max(0, Math.ceil(Math.log2(48 / (bar * pps)))));
        const k0 = Math.max(0, Math.floor((x0 - s.at) / bar));
        for (let k = k0; s.at + k * bar <= end && T.length < 2000; k++) {
          const t = s.at + k * bar;
          if (k % every === 0) { T.push(`<div class="tl-tick" style="left:${t * pps}px"><span>${k + 1}${k === 0 && s.label ? ' ' + esc(s.label) : ''}</span></div>`); G.push(`<div class="tl-grid bar" style="left:${t * pps}px"></div>`); }
          if (bl * pps >= 7) for (let b = 1; b < bpb(); b++) { const tb = t + b * bl; if (tb < end) { T.push(`<div class="tl-tick minor" style="left:${tb * pps}px"></div>`); if (bl * pps >= 14) G.push(`<div class="tl-grid" style="left:${tb * pps}px"></div>`); } }
        }
      });
    } else {
      const M = majorStep(), m = minorStep();
      for (let i = Math.floor(x0 / m); i * m <= x1 && T.length < 3000; i++) {
        const t = Math.round(i * m * 1000) / 1000, major = Math.abs(t / M - Math.round(t / M)) < 1e-6;
        T.push(`<div class="tl-tick ${major ? '' : 'minor'}" style="left:${t * pps}px">${major ? `<span>${fmt(t, M < 1)}</span>` : ''}</div>`);
        if (major) G.push(`<div class="tl-grid bar" style="left:${t * pps}px"></div>`); else if (m * pps >= 14) G.push(`<div class="tl-grid" style="left:${t * pps}px"></div>`);
      }
    }
    T.push(`<div class="tl-tick" style="left:${len() * pps}px;border-color:var(--red)"><span style="color:var(--red)">END</span></div>`);
    box.innerHTML = T.join(''); if (grid) grid.innerHTML = G.join('');
  }
  function drawCommentDots() {
    const box = $('#tl-cdots'); if (!box) return;
    box.innerHTML = (doc.comments || []).map((c) => `<div class="tl-cmt ${c.done ? 'done' : ''}" data-cmt="${esc(c.id)}" style="left:${c.at * pps}px" title="${esc(fmt(c.at, true) + ' · ' + (c.name || '') + ': ' + c.text)}"></div>`).join('');
  }

  // ---------------------------------------------------------------- comments
  function drawSide() {
    const side = $('#tl-side'); if (!side) return;
    const L = (doc.comments || []).slice().sort((a, b) => a.at - b.at);
    side.innerHTML = `<h4 class="small muted" style="margin:0 0 8px;letter-spacing:.12em">COMMENTS</h4>
      ${can.comment ? `<div style="margin-bottom:10px"><textarea id="tl-ctext" rows="2" placeholder="Comment at the playhead…" style="width:100%"></textarea>
        <div class="row" style="margin-top:4px"><select id="tl-ctrack" style="flex:1"><option value="">Whole show</option>${tracks().map((t) => `<option value="${esc(t.id)}" ${sel && sel.kind === 'track' && sel.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><button class="btn sm primary" id="tl-cadd">Add at <span id="tl-cat">${fmt(pos(), true)}</span></button></div></div>` : '<p class="small muted">Sign in to comment.</p>'}
      ${L.map((c) => `<div class="tl-c ${c.done ? 'done' : ''}" data-cgo="${esc(c.id)}"><div class="meta"><b>${fmt(c.at, true)}</b>${c.track && trackOf(c.track) ? '<span>' + esc(trackOf(c.track).name) + '</span>' : ''}<span class="sp"></span><span>${esc(c.name || '')}</span>
        ${can.comment ? `<button class="x" data-cdone="${esc(c.id)}" title="${c.done ? 'Open again' : 'Done'}">${c.done ? '↺' : '✓'}</button>${(me && c.by === me.id) || can.edit ? `<button class="x" data-cdel="${esc(c.id)}" title="Delete">✕</button>` : ''}` : ''}</div><div>${esc(c.text)}</div></div>`).join('') || '<p class="small muted">No comments yet.</p>'}`;
    const add = $('#tl-cadd', side);
    if (add) add.onclick = () => { const text = $('#tl-ctext', side).value.trim(); if (!text) return; CG.send('tl', 'comment', { id, at: Math.round(pos() * 100) / 100, track: $('#tl-ctrack', side).value, text }).then(() => CG.toast('Comment added', 'ok')).catch((e) => CG.toast(e.message, 'err')); };
    side.onclick = (e) => {
      const d1 = e.target.closest('[data-cdone]'), d2 = e.target.closest('[data-cdel]'), go = e.target.closest('[data-cgo]');
      if (d1) { CG.send('tl', 'resolve', { id, cid: d1.dataset.cdone }).catch((er) => CG.toast(er.message, 'err')); return; }
      if (d2) { CG.send('tl', 'uncomment', { id, cid: d2.dataset.cdel }).catch((er) => CG.toast(er.message, 'err')); return; }
      if (go && !e.target.closest('button')) { const c = (doc.comments || []).find((x) => x.id === go.dataset.cgo); if (c) { scrollTo(c.at); if (can.run && run.state !== 'playing') runCmd('seek', { pos: c.at }); } }
    };
  }
  function scrollTo(t) { const sc = $('#tl-scroll'); if (sc) sc.scrollLeft = Math.max(0, t * pps - sc.clientWidth / 3); }

  // ---------------------------------------------------------------- inspector
  function drawInsp() {
    const old = $('#tl-insp'); if (!old) return;
    const box = old.cloneNode(false);          // a fresh element: no listeners left from the last selection
    old.replaceWith(box);
    const x = findSel(), ro = can.edit ? '' : 'disabled';
    if (!x) {
      const src = doc.production || doc.fixture;
      box.appendChild(h(`<div><h4>Timeline<span class="sp"></span>${can.edit ? `<button class="btn sm" id="ti-import" ${src ? '' : 'disabled title="Choose a production or match on the Timeline record in RFP Manager first"'}>Import rundown</button>` : ''}</h4>
        <div class="form-grid">
          <label class="f"><span>Name</span><input type="text" data-k="name" value="${esc(doc.name || '')}" ${ro}></label>
          <label class="f"><span>Length</span><input type="text" data-k="length" data-t="1" value="${fmt(len())}" ${ro}></label>
          <label class="f"><span>Tempo (BPM)</span><input type="number" data-k="bpm" value="${Number(doc.bpm) || 120}" min="20" max="400" ${ro}></label>
          <label class="f"><span>Beats per bar</span><input type="number" data-k="beatsPerBar" value="${bpb()}" min="1" max="16" ${ro}></label>
        </div>
        <p class="small muted" style="margin:8px 0 0">Select a cue, a section or a track to change it. Keys: Space play/pause · Enter GO · Home back to the start · N new cue at the playhead on the selected track · M section at the playhead · Delete · Ctrl+D duplicate · Ctrl+C / Ctrl+V · Ctrl+Z undo · ←/→ nudge (Alt: no snap).</p></div>`));
      const imp = $('#ti-import', box); if (imp) imp.onclick = () => CG.send('tl', 'importRundown', { id, from: src }).then(() => CG.toast('Rundown brought in: sections and a Rundown track', 'ok')).catch((e) => CG.toast(e.message, 'err'));
      wireFields(box, doc, () => { drawCanvas(); });
      return;
    }
    if (sel.kind === 'cue') {
      const tr = trackOf(x.track);
      box.appendChild(h(`<div><h4>Cue on ${esc(tr ? tr.name : '')}<span class="sp"></span>
          <button class="btn sm" id="ci-from" title="Play from this cue">▶ From here</button><button class="btn sm" id="ci-fire" title="Run this cue's actions now, without moving the playhead">⚡ Try now</button>
          ${can.edit ? '<button class="btn sm" id="ci-dup">Duplicate</button><button class="btn sm danger" id="ci-del">Delete</button>' : ''}</h4>
        <div class="form-grid">
          <label class="f" style="grid-column:span 2"><span>Label</span><input type="text" data-k="label" value="${esc(x.label || '')}" ${ro} placeholder="CAM 2 wide · Chorus · LX 14 · VT 3"></label>
          <label class="f"><span>At</span><input type="text" data-k="at" data-t="1" value="${fmt(x.at, true)}" ${ro}></label>
          <label class="f"><span>Length</span><input type="text" data-k="dur" data-t="1" value="${x.dur ? fmt(x.dur, true) : ''}" placeholder="0 = a moment" ${ro}></label>
          <label class="f"><span>When the playhead gets here</span><select data-k="kind" ${ro}><option value="auto">fire and run on</option><option value="hold" ${x.kind === 'hold' ? 'selected' : ''}>hold until GO</option></select></label>
          <label class="f"><span>Track</span><select data-k="track" ${ro}>${tracks().map((t) => `<option value="${esc(t.id)}" ${t.id === x.track ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="f"><span>Colour</span><div class="row" style="gap:6px"><input type="checkbox" data-k="usecol" ${x.color ? 'checked' : ''} ${ro}><input type="color" data-k="color" value="${esc(x.color || colorOf(x))}" style="width:46px;height:28px;padding:0" ${ro}></div></label>
          <label class="f" style="grid-column:1/-1"><span>${tr && tr.kind === 'lyrics' ? 'Lyrics' : 'Text for the crew'}</span><textarea data-k="text" rows="${tr && tr.kind === 'lyrics' ? 3 : 2}" ${ro} style="width:100%">${esc(x.text || '')}</textarea></label>
        </div>
        <h4 style="margin-top:10px">Actions when it fires${tr && !tr.armed ? ' <span class="pill warn">track is off</span>' : ''}</h4><div id="ci-acts"></div></div>`));
      x.actions = x.actions || [];
      if (can.edit) $('#ci-acts', box).appendChild(CG.actionsEditor(x.actions, { hint: 'Values can use live values in braces, and {cue_label}, {cue_text}, {section} and {track} of this cue.' }));
      else $('#ci-acts', box).innerHTML = x.actions.length ? x.actions.map((a) => `<div class="small">${esc(a.do)} ${esc(a.target || '')} ${esc(a.method || '')} ${esc(a.value || '')}</div>`).join('') : '<span class="small muted">None</span>';
      $('#ci-from', box).onclick = () => runCmd('seek', { pos: x.at }).then(() => runCmd('play'));
      $('#ci-fire', box).onclick = () => runCmd('fire', { cue: x.id });
      if (can.edit) { $('#ci-dup', box).onclick = () => dup(x); $('#ci-del', box).onclick = () => del(); }
      wireFields(box, x, (k) => { if (k === 'track' || k === 'kind') drawInsp(); drawCanvas(); });
      return;
    }
    if (sel.kind === 'sec') {
      box.appendChild(h(`<div><h4>Section<span class="sp"></span><button class="btn sm" id="si-from">▶ From here</button>${can.edit ? '<button class="btn sm danger" id="si-del">Delete</button>' : ''}</h4>
        <div class="form-grid">
          <label class="f" style="grid-column:span 2"><span>Name</span><input type="text" data-k="label" value="${esc(x.label || '')}" ${ro} placeholder="Song 1 · Walk-in · Speech"></label>
          <label class="f"><span>Starts at</span><input type="text" data-k="at" data-t="1" value="${fmt(x.at, true)}" ${ro}></label>
          <label class="f"><span>Own tempo (BPM)</span><input type="number" data-k="bpm" value="${x.bpm || ''}" placeholder="timeline's" ${ro}></label>
          <label class="f"><span>Colour</span><div class="row" style="gap:6px"><input type="checkbox" data-k="usecol" ${x.color ? 'checked' : ''} ${ro}><input type="color" data-k="color" value="${esc(x.color || '#8892a6')}" style="width:46px;height:28px;padding:0" ${ro}></div></label>
        </div><p class="small muted" style="margin:8px 0 0">A section with its own tempo starts the bar count again at bar 1, so a song's bars line up with its click track.</p></div>`));
      $('#si-from', box).onclick = () => runCmd('seek', { pos: x.at }).then(() => runCmd('play'));
      if (can.edit) $('#si-del', box).onclick = () => del();
      wireFields(box, x, () => { secs().sort((a, b) => a.at - b.at); drawCanvas(); });
      return;
    }
    if (sel.kind === 'track') {
      const n = cues().filter((c) => c.track === x.id).length, i = tracks().indexOf(x);
      box.appendChild(h(`<div><h4>Track<span class="sp"></span>${can.edit ? `<button class="btn sm" id="ri-up" ${i ? '' : 'disabled'}>▲</button><button class="btn sm" id="ri-dn" ${i < tracks().length - 1 ? '' : 'disabled'}>▼</button><button class="btn sm" id="ri-new">+ Cue at playhead</button><button class="btn sm danger" id="ri-del">Delete track</button>` : ''}</h4>
        <div class="form-grid">
          <label class="f"><span>Name</span><input type="text" data-k="name" value="${esc(x.name || '')}" ${ro}></label>
          <label class="f"><span>Kind</span><select data-k="kind" ${ro}>${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
          <label class="f"><span>Who follows it</span><input type="text" data-k="crew" value="${esc(x.crew || '')}" ${ro} placeholder="Cam ops · LX desk · Band"></label>
          <label class="f"><span>Colour</span><div class="row" style="gap:6px"><input type="checkbox" data-k="usecol" ${x.color ? 'checked' : ''} ${ro}><input type="color" data-k="color" value="${esc(x.color || KIND[x.kind || 'other'][1])}" style="width:46px;height:28px;padding:0" ${ro}></div></label>
          <label class="chk" style="align-self:end"><input type="checkbox" data-k="armed" ${x.armed ? 'checked' : ''} ${ro}> Armed (its cues fire)</label>
        </div><p class="small muted" style="margin:8px 0 0">${n} cue${n === 1 ? '' : 's'}. Crew pick the tracks they follow in the crew view.</p></div>`));
      if (can.edit) {
        $('#ri-up', box).onclick = () => { pushUndo(); tracks().splice(i - 1, 0, tracks().splice(i, 1)[0]); edited(); draw(); };
        $('#ri-dn', box).onclick = () => { pushUndo(); tracks().splice(i + 1, 0, tracks().splice(i, 1)[0]); edited(); draw(); };
        $('#ri-new', box).onclick = () => newCue(x.id, snap(pos()));
        $('#ri-del', box).onclick = async () => { if (n && !(await CG.modal('Delete track', `<p>Delete “${esc(x.name)}” and its ${n} cue${n === 1 ? '' : 's'}?</p>`, { ok: 'Delete', danger: true }))) return; del(); };
      }
      wireFields(box, x, () => drawCanvas());
    }
  }
  // fields marked data-k edit the object; times (data-t) are typed as m:ss.t
  function wireFields(box, obj, after) {
    let pushed = false;
    box.addEventListener('focusin', (e) => { if (e.target.dataset.k && !pushed) { pushUndo(); pushed = true; } });
    box.addEventListener('focusout', () => { pushed = false; });
    const set = (el) => {
      const k = el.dataset.k; if (!k || !can.edit) return;
      if (k === 'usecol') { obj.color = el.checked ? $('[data-k="color"]', box).value : ''; }
      else if (k === 'color') { if ($('[data-k="usecol"]', box).checked) obj.color = el.value; else return; }
      else if (k === 'armed') obj.armed = el.checked;
      else if (el.dataset.t) { const v = parseT(el.value); if (v === null) return; obj[k] = Math.round(v * 100) / 100; }
      else if (el.type === 'number') obj[k] = Number(el.value) || 0;
      else obj[k] = el.value;
      edited(); after(k);
    };
    box.addEventListener('change', (e) => { if (e.target.dataset.k) set(e.target); });
    box.addEventListener('input', (e) => { if (e.target.dataset.k && e.target.tagName !== 'SELECT' && !e.target.dataset.t && e.target.type !== 'checkbox') set(e.target); });
    // the actions editor changes its list in place: save after its own handlers ran
    const acts = $('#ci-acts', box);
    if (acts) ['input', 'change', 'click'].forEach((ev) => acts.addEventListener(ev, () => setTimeout(() => { edited(); drawCanvasSoon(); }, 0)));
  }
  let dcT = null;
  const drawCanvasSoon = () => { clearTimeout(dcT); dcT = setTimeout(drawCanvas, 250); };

  // ---------------------------------------------------------------- edits
  function newCue(tid, at) {
    if (!can.edit) return;
    const t = trackOf(tid); if (!t) return;
    pushUndo();
    const c = { id: rid('cue'), track: tid, at, dur: t.kind === 'lyrics' || t.kind === 'shots' ? 0 : 0, label: t.kind === 'shots' ? 'CAM' : t.kind === 'lyrics' ? '' : '', text: '', color: '', kind: 'auto', actions: [] };
    cues().push(c); sel = { kind: 'cue', id: c.id }; edited(); drawCanvas(); drawInsp();
    const l = $('#tl-insp [data-k="label"]'); if (l) l.focus();
  }
  function dup(x) { pushUndo(); const c = Object.assign(JSON.parse(JSON.stringify(x)), { id: rid('cue'), at: snap(x.at + (x.dur || stepNudge())) }); cues().push(c); sel = { kind: 'cue', id: c.id }; edited(); drawCanvas(); drawInsp(); }
  function del() {
    const x = findSel(); if (!x || !can.edit) return;
    pushUndo();
    if (sel.kind === 'cue') doc.cues = cues().filter((c) => c !== x);
    else if (sel.kind === 'sec') doc.sections = secs().filter((s) => s !== x);
    else if (sel.kind === 'track') { doc.tracks = tracks().filter((t) => t !== x); doc.cues = cues().filter((c) => c.track !== x.id); }
    sel = null; edited(); draw();
  }
  function select(s) { sel = s; $$('.tl-cue.sel, .tl-sec.sel, .tl-head.sel').forEach((e) => e.classList.remove('sel')); if (s) { const el = s.kind === 'cue' ? $(`.tl-cue[data-cue="${s.id}"]`) : s.kind === 'sec' ? $(`.tl-sec[data-sec="${s.id}"]`) : $(`.tl-head[data-head="${s.id}"]`); if (el) el.classList.add('sel'); } drawInsp(); }

  // ---------------------------------------------------------------- mouse
  let drag = null;
  const timeAt = (clientX) => { const lane = $('#tl-ruler'); const r = lane.getBoundingClientRect(); return Math.max(0, (clientX - r.left) / pps); };
  document.addEventListener('pointerdown', (e) => {
    if (mode !== 'edit' || !doc || e.button !== 0) return;
    const cv = $('#tl-canvas'); if (!cv || !cv.contains(e.target)) return;
    const arm = e.target.closest('[data-arm]');
    if (arm) { if (!can.edit) return; const t = trackOf(arm.dataset.arm); pushUndo(); t.armed = !t.armed; edited(); drawCanvas(); if (sel && sel.id === t.id) drawInsp(); return; }
    const head = e.target.closest('[data-head]'); if (head) { select({ kind: 'track', id: head.dataset.head }); return; }
    const dot = e.target.closest('[data-cmt]'); if (dot) { sideOpen = true; $('#tl-side').classList.add('open'); const el = $(`[data-cgo="${dot.dataset.cmt}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); return; }
    const cueEl = e.target.closest('.tl-cue'), secEl = e.target.closest('.tl-sec');
    if (cueEl) {
      const c = cues().find((x) => x.id === cueEl.dataset.cue); if (!c) return;
      select({ kind: 'cue', id: c.id });
      if (!can.edit) return;
      drag = { kind: 'cue', obj: c, el: cueEl, x0: e.clientX, y0: e.clientY, at0: c.at, dur0: c.dur || 0, resize: !!e.target.closest('.rz'), moved: false, snap0: JSON.stringify(plain()) };
      cueEl.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (secEl) {
      const s = secs().find((x) => x.id === secEl.dataset.sec); if (!s) return;
      select({ kind: 'sec', id: s.id });
      if (!can.edit) return;
      drag = { kind: 'sec', obj: s, el: secEl, x0: e.clientX, y0: e.clientY, at0: s.at, moved: false, snap0: JSON.stringify(plain()) };
      secEl.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (e.target.closest('#tl-ruler')) { drag = { kind: 'scrub', t: timeAt(e.clientX) }; scrubTo(drag.t); e.preventDefault(); return; }
    if (e.target.closest('.tl-lane') && sel) select(null);
  });
  // touch: hold a finger on an empty part of a track to add a cue there
  let press = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || mode !== 'edit' || !doc || !can.edit) return;
    const lane = e.target.closest && e.target.closest('[data-lane]');
    if (!lane || e.target.closest('.tl-cue')) return;
    const x = e.clientX, y = e.clientY;
    press = { x, y, t: setTimeout(() => { press = null; if (navigator.vibrate) navigator.vibrate(15); newCue(lane.dataset.lane, snap(timeAt(x))); }, 550) };
  });
  const unpress = (e) => { if (press && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10)) { clearTimeout(press.t); press = null; } };
  document.addEventListener('pointerup', unpress); document.addEventListener('pointercancel', unpress); document.addEventListener('pointermove', unpress);
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'scrub') { drag.t = timeAt(e.clientX); scrubTo(drag.t); return; }
    const dx = (e.clientX - drag.x0) / pps;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4 && Math.abs(e.clientY - drag.y0) < 8) return;
    drag.moved = true;
    if (drag.kind === 'sec') { drag.obj.at = snap(drag.at0 + dx, e.altKey); drag.el.style.left = drag.obj.at * pps + 'px'; return; }
    const c = drag.obj;
    if (drag.resize) { c.dur = Math.max(0.1, snap(drag.at0 + drag.dur0 + dx, e.altKey) - c.at); drag.el.style.width = c.dur * pps + 'px'; return; }
    c.at = snap(drag.at0 + dx, e.altKey); drag.el.style.left = c.at * pps + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY), lane = under && under.closest && under.closest('[data-lane]');
    if (lane && lane.dataset.lane !== c.track) { c.track = lane.dataset.lane; lane.appendChild(drag.el); }
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'scrub') { if (can.run) runCmd('seek', { pos: Math.round(d.t * 100) / 100 }); else { run = { state: 'paused', pos: d.t, holdId: '' }; recvAt = Date.now(); } return; }
    if (!d.moved) return;
    undoL.push(d.snap0); if (undoL.length > 60) undoL.shift(); redoL = [];
    if (d.kind === 'sec') secs().sort((a, b) => a.at - b.at);
    edited(); drawCanvas(); drawInsp();
  });
  let scrubShown = null;
  function scrubTo(t) { scrubShown = t; $('#tl-time').textContent = fmt(t, true); }
  document.addEventListener('dblclick', (e) => {
    if (mode !== 'edit' || !doc || !can.edit) return;
    const lane = e.target.closest('[data-lane]');
    if (lane && !e.target.closest('.tl-cue')) { newCue(lane.dataset.lane, snap(timeAt(e.clientX), e.altKey)); return; }
    if (e.target.closest('#tl-secs') && !e.target.closest('.tl-sec')) { pushUndo(); const s = { id: rid('sec'), at: snap(timeAt(e.clientX), e.altKey), label: 'Section ' + (secs().length + 1), color: '', bpm: 0 }; secs().push(s); secs().sort((a, b) => a.at - b.at); sel = { kind: 'sec', id: s.id }; edited(); drawCanvas(); drawInsp(); }
  });
  document.addEventListener('wheel', (e) => {
    if (mode !== 'edit' || !(e.ctrlKey || e.metaKey) || !e.target.closest || !e.target.closest('#tl-scroll')) return;
    e.preventDefault();
    const sc = $('#tl-scroll'), t = timeAt(e.clientX), x = e.clientX - sc.getBoundingClientRect().left;
    pps = Math.max(2, Math.min(400, 4e6 / len(), pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); store.set('tl-pps', pps);
    drawCanvas(); sc.scrollLeft = t * pps + HEAD - x; drawTicks();
    const z = $('#tl-zoom'); if (z) z.value = Math.round(Math.log(pps / 2) / Math.log(200) * 100);
  }, { passive: false });

  // ---------------------------------------------------------------- keys
  document.addEventListener('keydown', (e) => {
    if (!doc) return;
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (typing) { if (k === 'Escape') e.target.blur(); return; }
    if (k === ' ') { e.preventDefault(); runCmd(run.state === 'playing' ? 'pause' : 'play'); return; }
    if (k === 'Enter') { e.preventDefault(); runCmd('go'); return; }
    if (k === 'Home') { e.preventDefault(); runCmd('stop'); return; }
    if (mode !== 'edit') return;
    const x = findSel();
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); undo(true); return; }
    if (k === 'Escape') { select(null); return; }
    if (!can.edit) return;
    if ((k === 'Delete' || k === 'Backspace') && x) { e.preventDefault(); del(); return; }
    if (mod && k.toLowerCase() === 'd' && x && sel.kind === 'cue') { e.preventDefault(); dup(x); return; }
    if (mod && k.toLowerCase() === 'c' && x && sel.kind === 'cue') { clip = JSON.parse(JSON.stringify(x)); CG.toast('Cue copied', 'ok'); return; }
    if (mod && k.toLowerCase() === 'v' && clip) { e.preventDefault(); pushUndo(); const c = Object.assign(JSON.parse(JSON.stringify(clip)), { id: rid('cue'), at: snap(pos()), track: sel && sel.kind === 'track' ? sel.id : (trackOf(clip.track) ? clip.track : (tracks()[0] || {}).id) }); if (!c.track) return; cues().push(c); sel = { kind: 'cue', id: c.id }; edited(); drawCanvas(); drawInsp(); return; }
    if (k.toLowerCase() === 'n' && !mod) { const tid = sel && sel.kind === 'track' ? sel.id : x && sel.kind === 'cue' ? x.track : (tracks()[0] || {}).id; if (tid) newCue(tid, snap(pos())); return; }
    if (k.toLowerCase() === 'm' && !mod) { addSection(); return; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && x && (sel.kind === 'cue' || sel.kind === 'sec')) {
      e.preventDefault(); pushUndo();
      const st = e.altKey ? 0.04 : stepNudge();
      x.at = Math.max(0, Math.round((x.at + (k === 'ArrowLeft' ? -st : st)) * 100) / 100); if (!e.altKey) x.at = snap(x.at);
      edited(); drawCanvas(); drawInsp(); return;
    }
    if (k === 'ArrowLeft' && !x) { runCmd('prev'); return; }
  });

  // ---------------------------------------------------------------- every frame: playhead, clock, next cue, crew view
  let lastDone = 0;
  function nextCue(p, filter) { return sorted().find((c) => c.at > p + 1e-3 && (!filter || filter(c)) && (trackOf(c.track) || {}).armed !== false); }
  function tickFrame(force) {
    if (!doc) return;
    const p = drag && drag.kind === 'scrub' && scrubShown !== null ? scrubShown : pos();
    if (!(drag && drag.kind === 'scrub')) $('#tl-time').textContent = fmt(Math.min(p, len()), true);
    const seg = segAt(p), sec = secs().slice().sort((a, b) => a.at - b.at).filter((s) => s.at <= p + 1e-6).pop();
    $('#tl-bb').textContent = (doc.units === 'beats' ? 'bar ' + bb(p) + ' · ' : '') + (sec ? sec.label : '') + (doc.units === 'beats' ? ' · ' + seg.bpm + ' BPM' : '');
    const n = run.state === 'held' ? cues().find((c) => c.id === run.holdId) : nextCue(p);
    const tn = $('#tl-next');
    tn.innerHTML = n ? `${run.state === 'held' ? 'HOLDING at' : 'Next'} <b>${esc(n.label || '·')}</b> <span class="muted">${esc((trackOf(n.track) || {}).name || '')}</span>${run.state === 'held' ? '' : ' in <b>' + cd(n.at - p) + '</b>'}` : '';
    if (mode === 'edit') {
      const ph = $('#tl-ph'), phr = $('#tl-phr'), cp = (drag && drag.kind === 'scrub' ? p : Math.min(p, len()));
      if (ph) ph.style.left = HEAD + cp * pps + 'px';
      if (phr) phr.style.left = cp * pps + 'px';
      const sc = $('#tl-scroll');
      if (sc && followHead && run.state === 'playing' && !drag) { const x = HEAD + p * pps; if (x < sc.scrollLeft + HEAD + 20 || x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = x - HEAD - 80; }
      if (force || Date.now() - lastDone > 300) { lastDone = Date.now(); $$('.tl-cue').forEach((el) => { const c = cues().find((x) => x.id === el.dataset.cue); if (c) el.classList.toggle('done', run.state !== 'stopped' && c.at + (c.dur || 0) < p); }); const ca = $('#tl-cat'); if (ca) ca.textContent = fmt(p, true); }
    } else crewFrame(p);
  }
  (function loop() { try { tickFrame(); } catch (e) { console.error(e); } requestAnimationFrame(loop); })();

  // ---------------------------------------------------------------- crew view
  const crewKey = () => 'tl-crew-' + (id || 'follow');
  const crewTracks = () => { const all = tracks().map((t) => t.id), k = store.get(crewKey(), null); const L = Array.isArray(k) ? k.filter((x) => all.includes(x)) : []; return L.length ? L : all; };
  function drawCrew(main) {
    const mine = crewTracks();
    main.innerHTML = `<div class="crew" style="grid-row:1/-1">
      <div class="crew-pick"><span class="small muted">I follow:</span>${tracks().map((t) => `<button class="btn sm ${mine.includes(t.id) ? 'on' : ''}" data-ct="${esc(t.id)}" style="border-color:${t.color || KIND[t.kind || 'other'][1]}">${esc(t.name)}</button>`).join('') || '<span class="muted">No tracks yet</span>'}
        <span class="sp" style="flex:1"></span>${follow ? '<span class="pill">FOLLOWING THE RUNNING TIMELINE</span>' : ''}</div>
      <div class="crew-top"><div class="crew-clock"><div class="big" id="cr-clock">0:00</div><div class="sub" id="cr-sec"></div></div>
        <div class="crew-next" id="cr-next"><div class="lbl" id="cr-nl">NEXT</div><div class="row" style="align-items:baseline"><div class="what" id="cr-what">–</div><span class="sp" style="flex:1"></span><div class="in" id="cr-in"></div></div><div class="small muted" id="cr-ntr"></div></div></div>
      <div class="crew-tracks" id="cr-tracks"></div>
      <div class="crew-list"><table id="cr-list"></table></div>
      ${can.comment ? `<div class="row"><input type="text" id="cr-ctext" placeholder="Note for the producer at this moment…" style="flex:1"><button class="btn" id="cr-cadd">Comment</button></div>` : ''}
    </div>`;
    $$('[data-ct]', main).forEach((b) => b.onclick = () => { const all = tracks().map((t) => t.id); let L = crewTracks(); if (L.length === all.length && !store.get(crewKey(), null)) L = []; L = L.includes(b.dataset.ct) ? L.filter((x) => x !== b.dataset.ct) : L.concat(b.dataset.ct); store.set(crewKey(), L); drawCrew(main); });
    const ca = $('#cr-cadd', main); if (ca) ca.onclick = () => { const t = $('#cr-ctext', main).value.trim(); if (!t) return; CG.send('tl', 'comment', { id, at: Math.round(pos() * 100) / 100, track: mine.length === 1 ? mine[0] : '', text: t }).then(() => { $('#cr-ctext', main).value = ''; CG.toast('Sent to the producer', 'ok'); }).catch((e) => CG.toast(e.message, 'err')); };
    crewSig = ''; crewFrame(pos());
  }
  let crewSig = '';
  function crewFrame(p) {
    const box = $('#cr-tracks'); if (!box) return;
    const mine = crewTracks(), sel2 = new Set(mine), S = secs().slice().sort((a, b) => a.at - b.at);
    const sec = S.filter((s) => s.at <= p + 1e-6).pop(), nsec = S.find((s) => s.at > p + 1e-6);
    $('#cr-clock').textContent = fmt(Math.min(p, len()));
    $('#cr-sec').textContent = [sec ? sec.label : '', nsec ? `next: ${nsec.label} in ${cd(nsec.at - p)}` : '', doc.units === 'beats' ? 'bar ' + bb(p) : ''].filter(Boolean).join(' · ') + (run.state === 'held' ? ' · HOLDING' : run.state === 'stopped' ? ' · stopped' : run.state === 'paused' ? ' · paused' : '');
    const n = run.state === 'held' ? cues().find((c) => c.id === run.holdId) : sorted().find((c) => c.at > p + 1e-3 && sel2.has(c.track));
    const nx = $('#cr-next');
    nx.className = 'crew-next' + (n && run.state === 'playing' && n.at - p <= 2 ? ' now' : n && run.state === 'playing' && n.at - p <= 10 ? ' soon' : run.state === 'held' ? ' soon' : '');
    $('#cr-nl').textContent = run.state === 'held' ? 'HOLDING – WAITING FOR GO' : n && run.state === 'playing' && n.at - p <= 10 ? 'STAND BY' : 'NEXT';
    $('#cr-what').textContent = n ? (n.label || '·') : '–';
    $('#cr-in').textContent = n && run.state !== 'held' ? cd(n.at - p) : '';
    $('#cr-ntr').textContent = n ? ((trackOf(n.track) || {}).name || '') + (n.text ? ' · ' + n.text.split('\n')[0] : '') : '';
    // per track: what is on now and what is next (rebuilt only when that changes; the countdowns are text updates)
    const per = mine.map((tid) => { const t = trackOf(tid), L = sorted().filter((c) => c.track === tid); const now = L.filter((c) => c.at <= p + 1e-3).pop(), nxt = L.find((c) => c.at > p + 1e-3); return { t, now, nxt }; }).filter((x) => x.t);
    const sig = JSON.stringify(per.map((x) => [x.t.id, x.now && x.now.id, x.nxt && x.nxt.id, x.t.name, x.now && x.now.label, x.now && x.now.text])) + run.state;
    if (sig !== crewSig) {
      crewSig = sig;
      box.innerHTML = per.map(({ t, now, nxt }) => `<div class="crew-tr" style="border-top-color:${t.color || KIND[t.kind || 'other'][1]}" ${now ? `data-crew-cue="${esc(now.id)}"` : ''}>
        <h3><span>${esc(t.name)}</span><span class="sp"></span>${t.armed ? '' : '<span class="pill">OFF</span>'}${t.crew ? `<span>${esc(t.crew)}</span>` : ''}</h3>
        <div class="crew-now ${t.kind === 'lyrics' ? 'lyric' : ''}">${now ? esc(t.kind === 'lyrics' && now.text ? now.text : now.label || '·') : '<span class="muted">–</span>'}</div>
        ${now && now.text && t.kind !== 'lyrics' ? `<div class="crew-text">${esc(now.text)}</div>` : ''}
        <div class="crew-prog"><div data-prog="${now && now.dur ? esc(now.id) : ''}"></div></div>
        <div class="crew-nextline">${nxt ? `<span>Next</span><b>${esc(nxt.label || (nxt.text || '').split('\n')[0] || '·')}</b><span class="in" data-in="${nxt.at}"></span>` : '<span>Nothing after this</span>'}</div></div>`).join('');
      const up = sorted().filter((c) => c.at > p + 1e-3 && sel2.has(c.track)).slice(0, 8);
      $('#cr-list').innerHTML = up.map((c) => `<tr><td class="t">${fmt(c.at)}</td><td><b>${esc(c.label || '·')}</b>${c.kind === 'hold' ? ' <span class="pill warn">HOLD</span>' : ''} <span class="muted">${esc((trackOf(c.track) || {}).name || '')}</span></td><td class="muted">${esc((c.text || '').split('\n')[0])}</td></tr>`).join('') || '<tr><td class="muted">Nothing more on these tracks.</td></tr>';
    }
    $$('[data-in]', box).forEach((el) => { el.textContent = run.state === 'held' ? '' : 'in ' + cd(Number(el.dataset.in) - p); });
    $$('[data-prog]', box).forEach((el) => { const c = cues().find((x) => x.id === el.dataset.prog); el.style.width = c && c.dur ? Math.max(0, Math.min(100, (p - c.at) / c.dur * 100)) + '%' : '0'; });
  }

  CG.connect('timeline');
})();
