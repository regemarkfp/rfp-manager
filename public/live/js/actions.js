/* RFP Manager – the editor for a list of actions (take / update / take off a graphic, invoke, set a field, run a macro,
   a vMix / ATEM / HyperDeck command, an AMCP command), each with a delay. Used by the scorer buttons (padkit.js), the
   macros and the Timeline cues. CG.actionsEditor(list, { macros, noMacro, hint }) returns an element that edits `list` in place. */
(function () {
  'use strict';
  const { $, esc, h } = CG;
  // ---------------------------------------------------------------- the action list editor (shared by buttons and macros)
  const DO = [['show', 'Take graphic'], ['update', 'Update graphic'], ['hide', 'Take off graphic'], ['invoke', 'Invoke method'], ['set', 'Set a field'], ['macro', 'Run macro'], ['device', 'Device command'], ['timeline', 'Timeline'], ['hideall', 'Take everything off'], ['setvar', 'Set a variable'], ['advert', 'Play an advert'], ['playlist', 'Start an ad playlist'], ['adstop', 'Stop the adverts'], ['amcp', 'AMCP command']];
  // adverts, playlists and variables come from the server once (CG.lists), the editor redraws when they arrive
  let listsAsked = false; const redraws = new Set();
  CG.on('dashLists', m => { CG.lists2 = m.lists || {}; redraws.forEach(f => f()); });
  const L = () => { if (!CG.lists2 && !listsAsked) { listsAsked = true; CG.on('connected', () => CG.send('dash', 'lists', {}).catch(() => {})); if (CG.connected) CG.send('dash', 'lists', {}).catch(() => {}); } return CG.lists2 || {}; };
  const opts2 = (list, sel, none) => `<option value="">${none}</option>` + (list || []).map(x => `<option value="${esc(x.id || x.key)}" ${(x.id || x.key) === sel ? 'selected' : ''}>${esc(x.name || x.key)}</option>`).join('');
  function graphicOptions(sel) {
    const groups = [...new Set((CG.catalog || []).filter(g => !g.hidden).map(g => g.group))];
    return `<option value="">choose a graphic…</option>` + groups.map(gr => `<optgroup label="${esc(gr)}">${CG.catalog.filter(g => g.group === gr && !g.hidden).map(g => `<option value="${esc(g.id)}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</optgroup>`).join('');
  }
  // vMix / ATEM / HyperDeck command: which device, the command (suggested per device) and its value
  function deviceFields(a) {
    const list = (CG.state && CG.state.devices && CG.state.devices.list) || [], d = list.find(x => x.id === a.target), dl = 'pad-dc-' + Math.random().toString(36).slice(2, 7);
    if (!list.length) return '<span class="small muted">No devices yet: add vMix, an ATEM or a HyperDeck in Graphics control → Settings.</span>';
    return `<select data-a="target" style="width:auto"><option value="">choose a device…</option>${list.map(x => `<option value="${esc(x.id)}" ${x.id === a.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <input type="text" data-a="method" list="${dl}" value="${esc(a.method || '')}" placeholder="${d && d.type === 'atem' ? 'cut, dsk-on, key-on …' : d && d.type === 'hyperdeck' ? 'record, stop, play …' : d && d.type === 'pigpio' ? 'pulse, on, off, toggle' : 'Cut, OverlayInput1In …'}" style="width:170px">
      <datalist id="${dl}">${((d && d.commands) || []).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <input type="text" data-a="value" value="${esc(a.value || '')}" placeholder="${d && d.type === 'atem' ? 'input=2 me=1 key=1 dsk=1' : d && d.type === 'hyperdeck' ? '' : d && d.type === 'pigpio' ? 'gpo=1 ms=200' : 'Input=2&Duration=500'}" style="width:170px">`;
  }
  const fieldsOf = id => { const g = (CG.catalog || []).find(x => x.id === id); return g ? (g.inputs || []).map(k => [k, (g.labels && g.labels[k]) || k]) : []; };
  function actionsEditor(list, opts) {
    opts = opts || {};
    const box = h('<div></div>'), uid = Math.random().toString(36).slice(2, 7);
    redraws.add(() => { if (document.body.contains(box)) draw(); });
    const draw = () => {
      box.innerHTML = list.map((a, i) => {
        const fl = fieldsOf(a.target), dl = 'pad-dl-' + uid + i;
        const values = Object.entries(a.values || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
        return `<div class="pad-act" data-i="${i}" style="border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:6px">
          <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
            <select data-a="do" style="width:auto">${DO.filter(([k]) => opts.noMacro ? k !== 'macro' : true).map(([k, l]) => `<option value="${k}" ${a.do === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${a.do === 'macro' ? `<select data-a="target" style="width:auto;min-width:200px"><option value="">choose a macro…</option>${(opts.macros || ((CG.state && CG.state.pads && CG.state.pads.macros) || [])).map(m => `<option value="${esc(m.id)}" ${m.id === a.target ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`
              : a.do === 'device' ? deviceFields(a)
              : a.do === 'hideall' ? '<span class="small muted">every graphic on program</span>'
              : a.do === 'adstop' ? '<span class="small muted">the advert or playlist that is playing</span>'
              : a.do === 'advert' ? `<select data-a="target" style="width:auto;min-width:200px">${opts2(L().adverts, a.target, 'choose an advert…')}</select>`
              : a.do === 'playlist' ? `<select data-a="target" style="width:auto;min-width:200px">${opts2(L().playlists, a.target, 'choose a playlist…')}</select>`
              : a.do === 'setvar' ? `<select data-a="target" style="width:auto;min-width:160px">${opts2((L().variables || []).map(v => ({ id: v.key, name: v.name + ' {var_' + v.key + '}' })), a.target, 'choose a variable…')}</select><span class="muted small">to</span><input type="text" data-a="value" value="${esc(a.value || '')}" placeholder="12 · +1 · -1 · toggle · {value} · text" style="width:200px">`
              : a.do === 'timeline' ? `<select data-a="method" style="width:auto">${['go', 'play', 'pause', 'stop', 'prev'].map(m => `<option value="${m}" ${(a.method || 'go') === m ? 'selected' : ''}>${m.toUpperCase()}</option>`).join('')}</select><span class="small muted">the timeline that is running</span>`
              : a.do === 'amcp' ? `<input type="text" data-a="value" value="${esc(a.value || '')}" placeholder='e.g. PLAY 1-10 "STING"' style="flex:1;min-width:220px">`
              : `<select data-a="target" style="width:auto;min-width:220px;max-width:320px">${graphicOptions(a.target)}</select>`}
            ${a.do === 'invoke' ? `<input type="text" data-a="method" value="${esc(a.method || '')}" placeholder="method, e.g. UpdateIn or page(2)" style="width:200px">` : ''}
            ${a.do === 'set' ? `<input type="text" data-a="field" list="${dl}" value="${esc(a.field || '')}" placeholder="field" style="width:140px"><span class="muted small">to</span><input type="text" data-a="value" value="${esc(a.value || '')}" placeholder="text, {live_value}, {nl} = new line" style="width:200px" title="{nl} starts a new line in a text box of several lines">` : ''}
            <span class="muted small">after</span><input type="number" data-a="delay" min="0" step="0.1" value="${a.delay || 0}" style="width:64px"><span class="muted small">s</span>
            <span class="sp" style="flex:1"></span><button class="btn sm ghost" data-x title="Remove this action">✕</button>
          </div>
          ${a.do === 'show' || a.do === 'update' ? `<div style="margin-top:6px"><textarea data-a="values" rows="${Math.max(2, Math.min(6, values.split('\n').length + 1))}" placeholder="Values to fill in, one per line:  field = value\nfor example:  line1 = TRY!   line2 = {last_text}   team_logo = {team{team}_logo}\n{nl} starts a new line:  line1 = FIRST LINE{nl}SECOND LINE" style="width:100%;font-family:var(--mono);font-size:12px">${esc(values)}</textarea>
            ${fl.length ? `<div class="small muted" style="margin-top:2px">Fields of this graphic: ${fl.slice(0, 30).map(([k, l]) => `<code data-ins="${esc(k)}" style="cursor:pointer" title="${esc(l)} – click to add">${esc(k)}</code>`).join(' ')}</div>` : ''}</div>` : ''}
          <datalist id="${dl}">${fl.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</datalist></div>`;
      }).join('') + `<div class="row" style="gap:6px"><button class="btn sm" data-add>+ Action</button><span class="small muted">${opts.hint || 'Values can use live values in braces ({teamA_name}, {last_text}, {commentator1} …) and {team} / {other} for the team of the button pressed (A or B).'}</span></div>`;
    };
    box.addEventListener('input', e => {
      const row = e.target.closest('[data-i]'), k = e.target.dataset.a; if (!row || !k) return;
      const a = list[Number(row.dataset.i)];
      if (k === 'values') { a.values = {}; e.target.value.split('\n').forEach(l => { const m = /^\s*([^=]+?)\s*=\s*(.*)$/.exec(l); if (m) a.values[m[1]] = m[2]; }); }
      else if (k === 'delay') a.delay = Number(e.target.value) || 0;
      else if (k !== 'do' && k !== 'target') a[k] = e.target.value;
    });
    box.addEventListener('change', e => {
      const row = e.target.closest('[data-i]'), k = e.target.dataset.a; if (!row || !k) return;
      const a = list[Number(row.dataset.i)];
      if (k === 'do') { a.do = e.target.value; a.target = ''; if (a.do === 'timeline') a.method = 'go'; draw(); }
      else if (k === 'target') { a.target = e.target.value; draw(); }
    });
    box.addEventListener('click', e => {
      if (e.target.closest('[data-add]')) { list.push({ do: 'show', target: '', values: {}, delay: 0 }); draw(); return; }
      const row = e.target.closest('[data-i]'); if (!row) return;
      if (e.target.closest('[data-x]')) { list.splice(Number(row.dataset.i), 1); draw(); return; }
      const ins = e.target.closest('[data-ins]');
      if (ins) { const ta = $('textarea', row); ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n') : '') + ins.dataset.ins + ' = '; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); }
    });
    draw();
    return box;
  }

  CG.actionsEditor = actionsEditor;
})();
