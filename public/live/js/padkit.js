/* RFP Manager – customisable scorer buttons (cricket and sports scorer).
   Every scoring button can be renamed, coloured, hidden, moved, put in a "More…" popup, and given actions that run after it
   scores: take a template with values, update / invoke / take off, set a field, run a macro, send an AMCP command.
   New buttons can do graphics only. The mapping and the macros are kept per theme (or for the team when no theme is in use). */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;
  // the parts of a button that say what it does (data-team, and attributes whose value is a team, are left out: one mapping for both teams)
  const KEYS = ['act', 'stat', 'card', 'scard', 'key', 'runs', 'extra', 'pt', 'how', 'so', 's', 'sub', 'foul', 'to', 'adjs', 'd', 'share', 'net'];
  const TEAMVAL = ['pt', 'so', 'sub', 'foul', 'to', 'adjs', 'scard', 'net'];
  const IDS = ['btn-wicket', 'btn-swap', 'btn-undo', 'btn-penalty', 'btn-declare', 'btn-end'];
  const ROOTS = '#page-score, #page-entry';
  let editing = false, applying = false;

  const pads = () => (CG.state && CG.state.pads) || { pad: { buttons: {}, custom: [] }, macros: [], where: null };
  const canEdit = () => !!(CG.rfp && CG.rfp.canScore);
  function sigOf(b) {
    if (b.id && IDS.includes(b.id)) return '#' + b.id;
    const parts = [];
    for (const k of KEYS) { const v = b.dataset[k]; if (v === undefined) continue; parts.push(TEAMVAL.includes(k) && (v === 'A' || v === 'B') ? k : k + '=' + v); }
    return parts.length && (b.dataset.act || b.dataset.stat || b.dataset.card || b.dataset.scard || b.dataset.runs !== undefined || b.dataset.extra !== undefined || b.dataset.pt || b.dataset.so || b.dataset.sub || b.dataset.foul || b.dataset.to || b.dataset.adjs || b.dataset.share || b.dataset.net) ? parts.join('|') : '';
  }
  const teamOf = b => { const t = b.dataset.team; if (t === 'A' || t === 'B') return t; for (const k of TEAMVAL) if (b.dataset[k] === 'A' || b.dataset[k] === 'B') return b.dataset[k]; return ''; };
  const firstText = b => { for (const n of b.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return n; return null; };
  const baseLabel = b => { if (!b.dataset.padLabel) { const t = firstText(b); b.dataset.padLabel = t ? t.nodeValue.trim() : b.textContent.trim(); } return b.dataset.padLabel; };
  const teamName = k => { const st = CG.state; if (!st || !k) return ''; if (st.mode === 'cricket') return (k === 'A' ? st.match.teamA : st.match.teamB).name; const su = st.sport && st.sport.setup; return su && su.teams && su.teams[k] ? su.teams[k].name : k; };

  // ---------------------------------------------------------------- look: what the mapping says, applied to the buttons on the page
  function apply() {
    if (applying) return;
    applying = true;
    try {
      const pad = pads().pad, more = [];
      $$(ROOTS).forEach(root => $$('button', root).forEach(b => {
        if (b.closest('#pad-bar, .modal, .pad-pop')) return;
        const sig = sigOf(b); if (!sig) return;
        const cfg = pad.buttons[sig] || {};
        b.dataset.padSig = sig;
        const t = firstText(b), want = cfg.label || baseLabel(b);
        if (t && t.nodeValue.trim() !== want) t.nodeValue = t.nodeValue.replace(t.nodeValue.trim(), want);
        b.style.borderColor = cfg.color || ''; b.style.boxShadow = cfg.color ? `inset 0 -3px 0 ${cfg.color}` : '';
        b.style.order = cfg.order ? String(cfg.order) : '';
        const away = cfg.hidden || cfg.more;
        b.classList.toggle('pad-away', !!away && !editing);
        b.classList.toggle('pad-ghost', !!away && editing);
        b.classList.toggle('pad-has', !!(cfg.actions && cfg.actions.length));
        b.title = editing ? 'Click to change this button' : (b.dataset.padTitle || b.title || '');
        if (cfg.more && !cfg.hidden) more.push({ label: want, team: teamOf(b), el: b });
      }));
      drawBar(more);
    } finally { applying = false; }
  }
  function drawBar(moreBuiltIn) {
    const root = $('#page-score'); if (!root) return;
    let bar = $('#pad-bar');
    if (!bar) { bar = h('<div id="pad-bar" class="panel" style="margin-bottom:12px"></div>'); root.insertBefore(bar, root.firstChild); }
    const P = pads(), custom = P.pad.custom || [], main = custom.filter(b => !b.more), more = custom.filter(b => b.more);
    const nMore = more.length + moreBuiltIn.length;
    const sig = JSON.stringify([custom, moreBuiltIn.map(x => x.label + x.team), editing, P.where, P.macros.length]);
    bar._more = moreBuiltIn;
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    const show = main.length || nMore || editing;
    bar.style.display = show ? '' : 'none';
    bar.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
      ${main.map(b => `<button class="btn ${b.team ? '' : ''}" data-padc="${esc(b.id)}" style="${b.color ? `border-color:${b.color};box-shadow:inset 0 -3px 0 ${b.color}` : ''}">${esc(b.label)}${b.team ? ` <span class="muted small">${esc(teamName(b.team))}</span>` : ''}</button>`).join('')}
      ${nMore ? `<button class="btn" id="pad-more">More… <span class="muted small">${nMore}</span></button>` : ''}
      <span class="sp" style="flex:1"></span>
      ${editing ? `<span class="small muted">Buttons for ${esc(P.where ? (P.where.kind === 'theme' ? 'theme “' + P.where.name + '”' : 'the standard graphics') : 'this match')}${P.where && P.where.sport ? ' · ' + esc(P.where.sport) : ''}</span>
        <button class="btn sm primary" id="pad-new">+ New button</button><button class="btn sm" id="pad-macros">Macros (${P.macros.length})…</button><button class="btn sm go" id="pad-done">Done</button>` : ''}</div>
      ${editing ? '<p class="small muted" style="margin:8px 0 0">Click any scoring button to rename it, colour it, hide it, put it under More…, or add graphics it plays after it scores. Dashed buttons are hidden or under More… for the operator.</p>' : ''}`;
    $$('[data-padc]', bar).forEach(x => x.onclick = () => { const b = custom.find(y => y.id === x.dataset.padc); if (!b) return; if (editing) openEditor({ custom: b }); else fire(b.actions, b.team, b.label); });
    const m = $('#pad-more', bar); if (m) m.onclick = () => openMore(more, bar._more);
    if (editing) {
      $('#pad-new', bar).onclick = () => openEditor({ custom: { id: '', label: '', color: '', more: false, team: '', actions: [{ do: 'show', target: '', values: {}, delay: 0 }] } });
      $('#pad-macros', bar).onclick = openMacros;
      $('#pad-done', bar).onclick = () => setEditing(false);
    }
  }
  function openMore(custom, builtIn) {
    const pop = h(`<div class="modal-back pad-pop"><div class="modal" style="width:min(640px,96vw)"><h3>More</h3>
      ${['', 'A', 'B'].map(tk => { const list = builtIn.filter(x => x.team === tk), cl = custom.filter(x => (x.team || '') === tk); if (!list.length && !cl.length) return ''; return `<div style="margin-bottom:10px">${tk ? `<div class="small muted" style="margin-bottom:4px">${esc(teamName(tk))}</div>` : ''}<div class="row" style="gap:8px;flex-wrap:wrap">${list.map((x, i) => `<button class="btn" data-bi="${builtIn.indexOf(x)}">${esc(x.label)}</button>`).join('')}${cl.map(b => `<button class="btn" data-cu="${esc(b.id)}" style="${b.color ? `border-color:${b.color}` : ''}">${esc(b.label)}</button>`).join('')}</div></div>`; }).join('')}
      <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div></div></div>`);
    pop.addEventListener('click', e => {
      if (e.target === pop || e.target.closest('[data-close]')) { pop.remove(); return; }
      const bi = e.target.closest('[data-bi]'), cu = e.target.closest('[data-cu]');
      if (bi) { pop.remove(); builtIn[Number(bi.dataset.bi)].el.click(); }
      if (cu) { pop.remove(); const b = custom.find(y => y.id === cu.dataset.cu); if (b) fire(b.actions, b.team, b.label); }
    });
    document.body.appendChild(pop);
  }
  function fire(actions, side, label, afterScore) {
    if (!actions || !actions.length) return;
    // after a scoring button the actions wait a moment, so the graphics get the new score
    setTimeout(() => CG.send('gfx', 'run', { actions, side: side || '', label: label || '' }).catch(err => CG.toast(err.message, 'err')), afterScore ? 350 : 0);
  }

  // ---------------------------------------------------------------- presses
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button[data-pad-sig]');
    if (!b || b.closest('#pad-bar, .modal, .pad-pop')) return;
    if (editing) { e.preventDefault(); e.stopImmediatePropagation(); openEditor({ sig: b.dataset.padSig, el: b }); return; }
    const cfg = pads().pad.buttons[b.dataset.padSig];
    if (cfg && cfg.actions && cfg.actions.length) fire(cfg.actions, teamOf(b), cfg.label || baseLabel(b), true);
  }, true);

  function setEditing(on) {
    editing = on && canEdit();
    document.body.classList.toggle('pad-editing', editing);
    const t = $('#pad-toggle'); if (t) t.classList.toggle('on', editing);
    const bar = $('#pad-bar'); if (bar) bar.dataset.sig = '';
    apply();
  }

  // the action list editor is shared with the Timeline: js/actions.js
  const actionsEditor = (list, opts) => CG.actionsEditor(list, Object.assign({ macros: pads().macros }, opts || {}));

  // ---------------------------------------------------------------- button editor
  function openEditor(o) {
    const P = pads(), pad = JSON.parse(JSON.stringify(P.pad));
    const isCustom = !!o.custom;
    const cfg = isCustom ? JSON.parse(JSON.stringify(o.custom)) : Object.assign({ label: '', color: '', hidden: false, more: false, order: 0, actions: [] }, JSON.parse(JSON.stringify(pad.buttons[o.sig] || {})));
    cfg.actions = cfg.actions || [];
    const std = isCustom ? '' : baseLabel(o.el);
    const m = h(`<div class="modal-back"><div class="modal" style="width:min(860px,96vw);max-height:92vh;overflow:auto"><h3>${isCustom ? (cfg.id ? 'Button' : 'New button') : `Scoring button “${esc(std)}”`}</h3>
      <div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <label class="f"><span>Text on the button</span><input type="text" id="pe-label" value="${esc(cfg.label)}" placeholder="${esc(std || 'e.g. Try graphic')}"></label>
        <label class="f"><span>Colour</span><div class="row" style="gap:6px"><input type="checkbox" id="pe-usecol" ${cfg.color ? 'checked' : ''}><input type="color" id="pe-color" value="${esc(cfg.color || '#2f6bff')}" style="width:48px;height:30px;padding:0"></div></label>
        ${isCustom ? `<label class="f"><span>For</span><select id="pe-team"><option value="">no team</option><option value="A" ${cfg.team === 'A' ? 'selected' : ''}>${esc(teamName('A'))} (A)</option><option value="B" ${cfg.team === 'B' ? 'selected' : ''}>${esc(teamName('B'))} (B)</option></select></label>`
          : `<label class="f"><span>Position</span><input type="number" id="pe-order" value="${cfg.order || 0}" title="Lower comes first; 0 = where it is"></label>`}
        <label class="f"><span>Where</span><select id="pe-where"><option value="main">on the scorer</option><option value="more" ${cfg.more ? 'selected' : ''}>under More…</option>${isCustom ? '' : `<option value="hidden" ${cfg.hidden ? 'selected' : ''}>hidden</option>`}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">Shortcut</h4>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
        <span class="small muted">Keyboard</span><input type="text" id="pe-key" readonly placeholder="none" style="width:110px;text-align:center;font-family:var(--mono)"><button class="btn sm" id="pe-key-learn">◉ Learn key</button><button class="btn sm ghost" id="pe-key-x" title="No keyboard shortcut">✕</button>
        <span class="small muted" style="margin-left:12px">Hardware</span><input type="text" id="pe-in" placeholder="midi_note60 · xkeys_key5 · pi_gpi1" style="width:200px;font-family:var(--mono)"><button class="btn sm" id="pe-in-learn" title="Press the MIDI pad, X-keys key, Pi button or send the OSC message">◉ Learn button</button><button class="btn sm ghost" id="pe-in-x" title="No hardware shortcut">✕</button>
      </div>
      <p class="small muted" style="margin:4px 0 0">${isCustom || !teamOf(o.el) ? '' : `For ${esc(teamName(teamOf(o.el)))}'s button. `}Hardware shortcuts need the device in Settings → Connections, and work on screens where HW KEYS is on.</p>
      <h4 style="margin:14px 0 6px">${isCustom ? 'When pressed' : 'After it scores, also'}</h4><div id="pe-acts"></div>
      <p class="small muted">${isCustom ? '' : 'The button still scores as before; these run a moment later so the graphics get the new score. '}Saved for ${esc(P.where ? (P.where.kind === 'theme' ? 'theme “' + P.where.name + '”' : 'the standard graphics (no theme)') : 'this match')}${P.where && P.where.sport ? ', ' + esc(P.where.sport) : ''}.</p>
      <div class="modal-actions">${isCustom && cfg.id ? '<button class="btn danger" data-del>Delete button</button>' : ''}${!isCustom && pad.buttons[o.sig] ? '<button class="btn ghost" data-reset>Back to standard</button>' : ''}<span class="sp" style="flex:1"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div></div></div>`);
    $('#pe-acts', m).appendChild(actionsEditor(cfg.actions));
    pad.shortcuts = pad.shortcuts || {};
    const scOld = isCustom ? (cfg.id ? 'c:' + cfg.id : '') : o.sig + '|' + teamOf(o.el);
    const sc = Object.assign({ key: '', input: '' }, scOld ? pad.shortcuts[scOld] : null);
    $('#pe-key', m).value = sc.key; $('#pe-in', m).value = sc.input;
    $('#pe-key-x', m).onclick = () => { $('#pe-key', m).value = ''; };
    $('#pe-in-x', m).onclick = () => { $('#pe-in', m).value = ''; };
    $('#pe-key-learn', m).onclick = (ev) => { const b = ev.currentTarget; b.textContent = 'Press a key…'; b.classList.add('primary'); learnKey((k) => { b.textContent = '◉ Learn key'; b.classList.remove('primary'); if (k) $('#pe-key', m).value = k; }); };
    $('#pe-in-learn', m).onclick = (ev) => { const b = ev.currentTarget; b.textContent = 'Press it now…'; b.classList.add('primary'); learnInput((x) => { b.textContent = '◉ Learn button'; b.classList.remove('primary'); if (x) { $('#pe-in', m).value = x.key; setHw(true); CG.toast(`Learnt ${x.key} from ${x.device}`, 'ok'); } else CG.toast('Nothing was pressed (is the device added and connected in Settings → Connections?)', 'err'); }); };
    const save = next => CG.send('rfp', 'pads', { pad: next }).then(() => { CG.toast('Buttons saved', 'ok'); m.remove(); }).catch(e => CG.toast(e.message, 'err'));
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-close]')) { m.remove(); return; }
      if (e.target.closest('[data-del]')) { pad.custom = pad.custom.filter(x => x.id !== cfg.id); if (pad.shortcuts) delete pad.shortcuts['c:' + cfg.id]; save(pad); return; }
      if (e.target.closest('[data-reset]')) { delete pad.buttons[o.sig]; save(pad); return; }
      if (!e.target.closest('[data-save]')) return;
      cfg.label = $('#pe-label', m).value.trim();
      cfg.color = $('#pe-usecol', m).checked ? $('#pe-color', m).value : '';
      const where = $('#pe-where', m).value;
      cfg.more = where === 'more'; cfg.hidden = where === 'hidden';
      cfg.actions = cfg.actions.filter(a => a.do === 'hideall' || a.do === 'timeline' || a.do === 'adstop' ? true : a.do === 'amcp' ? (a.value || '').trim() : a.do === 'device' ? a.target && (a.method || '').trim() : a.do === 'invoke' ? a.target && (a.method || '').trim() : a.do === 'set' ? a.target && a.field : a.target);
      const scNew = { key: $('#pe-key', m).value.trim(), input: $('#pe-in', m).value.trim().replace(/^\{|\}$/g, '') };
      const keepSc = (k) => { if (scOld && scOld !== k) delete pad.shortcuts[scOld]; if (scNew.key || scNew.input) pad.shortcuts[k] = scNew; else delete pad.shortcuts[k]; };
      if (isCustom) {
        if (!cfg.label) { CG.toast('Give the button a text', 'err'); return; }
        cfg.team = $('#pe-team', m).value;
        if (cfg.id) pad.custom = pad.custom.map(x => (x.id === cfg.id ? cfg : x)); else { cfg.id = 'btn_' + Math.random().toString(36).slice(2, 10); pad.custom.push(cfg); }
        keepSc('c:' + cfg.id);
      } else { cfg.order = Number($('#pe-order', m).value) || 0; pad.buttons[o.sig] = cfg; keepSc(o.sig + '|' + teamOf(o.el)); }
      save(pad);
    });
    $('#pe-usecol', m).onchange = () => {}; $('#pe-color', m).oninput = () => { $('#pe-usecol', m).checked = true; };
    document.body.appendChild(m);
  }

  // ---------------------------------------------------------------- macros: named action lists any button can run
  function openMacros() {
    const P = pads(), list = JSON.parse(JSON.stringify(P.macros || []));
    let cur = list[0] || null;
    const m = h(`<div class="modal-back"><div class="modal" style="width:min(900px,96vw);max-height:92vh;overflow:auto"><h3>Macros</h3>
      <p class="small muted" style="margin-top:0">A macro is a list of actions with a name. Any button (in the scorer, or on a template) can run it with "Run macro". Saved for ${esc(P.where ? (P.where.kind === 'theme' ? 'theme “' + P.where.name + '”' : 'the standard graphics') : 'this match')}.</p>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:12px"><div id="mc-list"></div><div id="mc-edit"></div></div>
      <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save macros</button></div></div></div>`);
    const draw = () => {
      $('#mc-list', m).innerHTML = list.map((x, i) => `<div class="row" style="gap:4px;margin-bottom:4px"><button class="btn sm ${x === cur ? 'on' : ''}" data-pick="${i}" style="flex:1;text-align:left">${esc(x.name || 'Untitled')}</button><button class="btn sm ghost" data-rm="${i}" title="Delete">✕</button></div>`).join('') + '<button class="btn sm primary" data-new>+ Macro</button>';
      const ed = $('#mc-edit', m); ed.innerHTML = '';
      if (!cur) { ed.innerHTML = '<p class="muted">No macro chosen.</p>'; return; }
      const name = h(`<label class="f"><span>Name</span><input type="text" value="${esc(cur.name || '')}"></label>`);
      $('input', name).oninput = e => { cur.name = e.target.value; const b = $(`[data-pick="${list.indexOf(cur)}"]`, m); if (b) b.textContent = cur.name || 'Untitled'; };
      ed.appendChild(name);
      cur.actions = cur.actions || [];
      ed.appendChild(actionsEditor(cur.actions, { noMacro: true }));
    };
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-close]')) { m.remove(); return; }
      const p = e.target.closest('[data-pick]'), r = e.target.closest('[data-rm]');
      if (p) { cur = list[Number(p.dataset.pick)]; draw(); return; }
      if (r) { const x = list.splice(Number(r.dataset.rm), 1)[0]; if (x === cur) cur = list[0] || null; draw(); return; }
      if (e.target.closest('[data-new]')) { cur = { id: 'mac_' + Math.random().toString(36).slice(2, 10), name: 'New macro', actions: [{ do: 'show', target: '', values: {}, delay: 0 }] }; list.push(cur); draw(); return; }
      if (e.target.closest('[data-save]')) CG.send('rfp', 'macros', { list }).then(() => { CG.toast('Macros saved', 'ok'); m.remove(); }).catch(err => CG.toast(err.message, 'err'));
    });
    draw();
    document.body.appendChild(m);
  }

  // ---------------------------------------------------------------- start
  const css = document.createElement('style');
  css.textContent = `.pad-away{display:none!important}.pad-ghost{opacity:.45;border-style:dashed!important}
    body.pad-editing #page-score button[data-pad-sig], body.pad-editing #page-entry button[data-pad-sig]{outline:1px dashed var(--accent);outline-offset:2px;cursor:context-menu}
    button.pad-has::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:6px;vertical-align:middle}`;
  document.head.appendChild(css);
  // ---------------------------------------------------------------- shortcuts: keyboard keys and hardware buttons
  const combo = e => { let k = e.key; if (!k || ['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return ''; if (k === ' ') k = 'Space'; if (k.length === 1) k = k.toUpperCase(); return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && k.length > 1 ? 'Shift+' : '') + k; };
  let keyLearner = null, inputLearner = null, inputTimer = null;
  function learnKey(done) { keyLearner = done; }
  function learnInput(done) { clearTimeout(inputTimer); inputLearner = done; inputTimer = setTimeout(() => { if (inputLearner) { const f = inputLearner; inputLearner = null; f(null); } }, 15000); }
  const hwOn = () => String(CG.store.get('padHw', '')) === '1';
  function setHw(on) { CG.store.set('padHw', on ? '1' : ''); paintHw(); }
  function paintHw() {
    const sc = (pads().pad.shortcuts) || {}, any = Object.values(sc).some(x => x && x.input);
    let p = $('#pad-hw');
    if (!any) { if (p) p.remove(); return; }
    if (!p) { const pills = $('.topbar .pills'); if (!pills) return; p = h('<button class="pill" id="pad-hw" style="cursor:pointer" title="Hardware shortcuts (MIDI, X-keys, GPI, OSC) press this screen\'s buttons. Have it on in one scorer only, or a press scores twice."></button>'); p.onclick = () => { setHw(!hwOn()); CG.toast(hwOn() ? 'Hardware shortcuts on for this screen' : 'Hardware shortcuts off for this screen', 'ok'); }; pills.insertBefore(p, pills.firstChild); }
    p.textContent = hwOn() ? '◉ HW KEYS ON' : '○ HW KEYS OFF'; p.className = 'pill' + (hwOn() ? ' ok' : '');
  }
  function press(k) {
    if (k.startsWith('c:')) { const b = (pads().pad.custom || []).find(x => 'c:' + x.id === k); if (b) fire(b.actions, b.team, b.label); return !!b; }
    const [sig, team] = k.split('|');
    const el = $$('button[data-pad-sig]').find(b => b.dataset.padSig === sig && teamOf(b) === (team || '') && !b.closest('#pad-bar, .modal, .pad-pop'));
    if (el && !el.disabled) { el.click(); return true; }
    return false;
  }
  const findSc = test => Object.entries((pads().pad.shortcuts) || {}).filter(([, x]) => x && test(x)).map(([k]) => k);
  document.addEventListener('keydown', e => {
    if (keyLearner) { if (e.key === 'Escape') { const f = keyLearner; keyLearner = null; f(''); e.preventDefault(); e.stopImmediatePropagation(); return; } const c = combo(e); if (!c) return; e.preventDefault(); e.stopImmediatePropagation(); const f = keyLearner; keyLearner = null; f(c); return; }
    if (editing || $('.modal-back') || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'))) return;
    const c = combo(e); if (!c) return;
    const hits = findSc(x => x.key && x.key.toLowerCase() === c.toLowerCase());
    if (!hits.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) hits.forEach(press);
  }, true);
  CG.on('devInput', x => {
    if (inputLearner && (x.pressed || (x.value && !x.released && (x.kind === 'osc' || /_cc\d+$/.test(x.key))))) { clearTimeout(inputTimer); const f = inputLearner; inputLearner = null; f(x); return; }
    if (!hwOn() || editing || $('.modal-back') || !(x.pressed || (x.kind === 'osc' && x.value))) return;
    findSc(y => y.input === x.key).forEach(press);
  });

  function addToggle() {
    const pills = $('.topbar .pills'); if (!pills || $('#pad-toggle')) return;
    const t = h('<button class="pill" id="pad-toggle" title="Change what the scoring buttons are called and what graphics they play" style="cursor:pointer">✎ BUTTONS</button>');
    t.onclick = () => { if (!canEdit()) { CG.toast('Sign in as a Scorer to change the buttons', 'err'); return; } setEditing(!editing); };
    pills.insertBefore(t, pills.firstChild);
  }
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(apply, 30); };
  CG.on('state', () => { addToggle(); paintHw(); later(); });
  CG.on('catalog', later);
  document.addEventListener('DOMContentLoaded', () => { addToggle(); $$(ROOTS).forEach(r => new MutationObserver(() => { if (!applying) later(); }).observe(r, { childList: true, subtree: true })); });
  if (document.readyState !== 'loading') { addToggle(); $$(ROOTS).forEach(r => new MutationObserver(() => { if (!applying) later(); }).observe(r, { childList: true, subtree: true })); }
})();
