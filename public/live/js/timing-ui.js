/* RFP Manager – Timing tab of the athletics scorer: connect photo-finish systems and timers (FinishLynx, ALGE, any
 * other) so start lists, the race clock, results, reaction times and wind come in by themselves. The listening happens
 * in RFP Manager on the production PC (lib/timing.js); this page sets it up and shows what arrives. */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: Object.assign({ 'x-rfp': '1' }, body !== undefined ? { 'content-type': 'application/json' } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  };
  const sel = (name, list, cur, attrs = '') => `<select name="${name}" ${attrs}>${list.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;

  const KINDS = [['udp', 'Network – UDP'], ['tcp', 'Network – TCP'], ['serial', 'Serial / COM port'], ['folder', 'Result files in a folder']];
  const FORMATS = [['auto', 'Recognise it (results, clock, wind)'], ['lynx', 'FinishLynx / Hy-Tek files (.evt .ppl .lif)'], ['alge', 'ALGE timer (Timy, Comet)'], ['running', 'Running time only'], ['custom', 'My own layout (rules below)']];
  const PRESETS = [
    { key: 'lynx-files', label: 'FinishLynx – start lists and official results (files)', input: { name: 'FinishLynx files', kind: 'folder', format: 'lynx', folder: 'C:\\Lynx' },
      help: 'In FinishLynx: Options → Database: set the Input directory to a folder this PC can see (a shared folder works) and tick “Write LIF”. Put the same folder here. Start lists (lynx.evt / lynx.ppl from your meet software) become events; every .lif file becomes the official results.' },
    { key: 'lynx-clock', label: 'FinishLynx – running time (scoreboard)', input: { name: 'FinishLynx running time', kind: 'udp', format: 'running', port: 5320 },
      help: 'In FinishLynx: Scoreboard → Options → New. Script: a running-time script (most send just the time). Serial port: Network (UDP). IP address: this PC. Port: the one here. Running time: Normal. Results: Off.' },
    { key: 'lynx-board', label: 'FinishLynx – live results (scoreboard)', input: { name: 'FinishLynx results board', kind: 'tcp', mode: 'listen', format: 'auto', port: 5321 },
      help: 'In FinishLynx: Scoreboard → Options → New. Script: a results script that sends place, lane, name and time. Serial port: Network (Connect). IP address: this PC. Port: the one here. Results: Auto. Watch the monitor below: if a line is not understood, add a rule (My own layout).' },
    { key: 'alge', label: 'ALGE timer (Timy, Comet) – serial', input: { name: 'ALGE timer', kind: 'serial', format: 'alge', baud: 9600 },
      help: 'Connect the timer’s RS-232 output (USB adapter is fine) and choose its COM port. Timy default: 9600 baud, 8 bits, no parity. Starts (C0) start the race clock; net times (RT) and finishes (C1) become results by bib.' },
    { key: 'other-net', label: 'Another system – network', input: { name: 'Timing system', kind: 'udp', format: 'auto', port: 5322 },
      help: 'Point the system’s scoreboard or data output at this PC and the port here. If lines show as not understood in the monitor, switch to “My own layout” and add rules.' },
    { key: 'other-serial', label: 'Another system – serial', input: { name: 'Timing system (serial)', kind: 'serial', format: 'auto', baud: 9600 }, help: 'Choose the COM port and its settings (see the system’s manual).' },
    { key: 'other-files', label: 'Another system – result files (CSV / text)', input: { name: 'Result files', kind: 'folder', format: 'custom', folder: '' },
      help: 'Every .csv / .txt file in the folder is read with your rules; the file name is used as the event name unless a rule says otherwise.' },
  ];
  const RULE_TYPES = [['result', 'Result (place, name, time)'], ['entry', 'Start list entry'], ['clock', 'Running time'], ['event', 'Event name'], ['wind', 'Wind'], ['start', 'Gun / start'], ['stop', 'Clock stopped'], ['ignore', 'Ignore these lines']];
  const WHENS = [['any', 'Any line'], ['starts', 'Lines starting with'], ['contains', 'Lines containing'], ['regex', 'Lines matching (pattern)']];
  const SPLITS = [['controls', 'Control codes'], ['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab'], ['pipe', 'Bar |'], ['spaces', '2+ spaces'], ['space', 'Each space']];
  const FIELDS = [['place', 'Place'], ['lane', 'Lane'], ['bib', 'Bib'], ['name', 'Full name'], ['first', 'First name'], ['last', 'Last name'], ['team', 'Team'], ['time', 'Time / mark'], ['reaction', 'Reaction'], ['wind', 'Wind'], ['event', 'Event name'], ['clock', 'Running time'], ['heat', 'Heat']];
  const COLS = [['', '–'], ...Array.from({ length: 20 }, (_, i) => [String(i + 1), 'Column ' + (i + 1)])];
  const BAUDS = ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'];

  let data = null, timer = null, root = null, ports = null, editing = null;

  function summary(i) {
    const k = i.kind === 'folder' ? `folder ${i.folder || '?'}` : i.kind === 'serial' ? `${i.com || 'COM ?'} · ${i.baud} baud` : `${i.kind.toUpperCase()} ${i.mode === 'connect' ? `→ ${i.host || '127.0.0.1'}:` : 'port '}${i.port || '?'}`;
    return `${k} · ${(FORMATS.find((f) => f[0] === i.format) || ['', i.format])[1]}`;
  }
  const dot = (s) => ({ connected: 'var(--accent)', listening: 'var(--accent)', waiting: 'var(--amber)', error: 'var(--red)' })[s] || 'var(--muted)';
  const what = (m) => {
    if (!m) return '<span class="muted">not understood</span>';
    switch (m.t) {
      case 'clock': return `clock ${esc((m.ms / 1000).toFixed(2))}`;
      case 'result': return `result: ${esc([m.place && '#' + m.place, m.lane && 'lane ' + m.lane, m.bib && 'bib ' + m.bib, m.name, m.team, m.time, m.reaction && 'RT ' + m.reaction].filter(Boolean).join(' · '))}`;
      case 'entry': return `entry: ${esc([m.lane && 'lane ' + m.lane, m.bib, m.name, m.team].filter(Boolean).join(' · '))}`;
      case 'event': return `event: ${esc(m.name)}`;
      case 'wind': return `wind ${esc(m.value)}`;
      case 'startlist': return `start list: ${esc(m.name)} (${m.entries} entries)`;
      case 'results': return `results: ${esc(m.name)} (${m.entries} rows)`;
      default: return esc(m.t);
    }
  };

  function paint() {
    if (!root) return;
    if (!data) { root.innerHTML = '<div class="panel"><p class="muted">Loading…</p></div>'; return; }
    if (data.cloud) { root.innerHTML = `<div class="panel" data-nofold><h4>Timing systems</h4><p>${esc(data.cloud)}</p></div>`; return; }
    const s = data.settings, focus = document.activeElement;
    if (root.contains(focus) && focus.matches('input,select,textarea') && !focus.closest('#tm-monitor')) { paintLive(); return; }
    root.innerHTML = `<div class="grid cols-2">
      <div>
        <div class="panel" data-nofold><h4>Timing systems <span class="sp"></span>${sel('preset', [['', '+ Add a timing system…'], ...PRESETS.map((p) => [p.key, p.label])], '', 'id="tm-add"')}</h4>
          <div id="tm-inputs">${s.inputs.length ? '' : '<p class="muted">Nothing connected yet. Add your photo-finish system or timer above.</p>'}</div>
          ${data.error ? `<p class="small" style="color:var(--amber);margin:8px 0 0">${esc(data.error)}</p>` : ''}${data.note ? `<p class="small muted" style="margin:6px 0 0">${esc(data.note)}</p>` : ''}
        </div>
        <div class="panel" data-nofold style="margin-top:12px"><h4>What timing changes</h4>
          <label class="row"><input type="checkbox" id="tm-follow" ${s.follow ? 'checked' : ''}> Make the race being timed the current event (graphics follow it)</label>
          <label class="row"><input type="checkbox" id="tm-auto" ${s.autoCreate ? 'checked' : ''}> Make events that are not set up yet (gender, age group and discipline are read from the name)</label>
          <label class="row"><input type="checkbox" id="tm-clock" ${s.clock ? 'checked' : ''}> Run the race clock from the timing system</label>
          <label class="row"><input type="checkbox" id="tm-fsl" ${s.followStartLists ? 'checked' : ''}> A new start list also becomes the current event</label>
          <p class="small muted" style="margin:6px 0 0">Results from the result files (.lif) are official: lines from a scoreboard never overwrite them. Results typed on the Score tab still work as before.</p>
        </div>
        <div class="panel" data-nofold style="margin-top:12px"><h4>Try it</h4>
          <p class="small muted" style="margin:0 0 6px">Paste lines the way the system sends them to see how they are read, or send them into the meet by hand.</p>
          <div class="row" style="margin-bottom:6px">${sel('tin', [['', 'As: recognise it'], ...s.inputs.map((i) => [i.id, 'As: ' + (i.name || i.id)])], '', 'id="tm-tin"')}</div>
          <textarea id="tm-text" rows="5" placeholder="1|3|67|Michael Mouse|Florida State|10.23|0.141"></textarea>
          <div class="row" style="margin-top:6px"><button class="btn sm" id="tm-preview">Show how it is read</button><button class="btn sm primary" id="tm-inject">Send into the meet</button></div>
          <div id="tm-pv" class="small" style="margin-top:6px"></div>
        </div>
      </div>
      <div class="panel" data-nofold id="tm-monitor"><h4>What comes in <span class="sp"></span><span class="small muted">${data.applied ? data.applied + ' updates to the meet' : ''}</span></h4><div id="tm-lines"></div></div>
    </div><div id="tm-edit"></div>`;
    paintLive();
    wire();
    if (editing) paintEditor();
  }
  function paintLive() {
    const box = $('#tm-inputs');
    if (box && data.settings.inputs.length) box.innerHTML = data.settings.inputs.map((i) => {
      const st = data.inputs.find((x) => x.id === i.id) || {};
      return `<div class="row" style="align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <span style="width:10px;height:10px;border-radius:50%;margin-top:5px;flex:none;background:${i.on ? dot(st.state) : 'var(--line2)'}"></span>
        <div style="flex:1;min-width:0"><b>${esc(i.name || 'Timing system')}</b> <span class="small muted">${esc(summary(i))}</span>
          <div class="small ${st.error ? '' : 'muted'}" style="${st.error ? 'color:var(--red)' : ''}">${i.on ? esc(st.error || st.detail || st.state || '') : 'off'}${st.lines ? ` · ${st.lines} lines, ${st.parsed} understood${st.lastAt ? ', last ' + Math.max(0, Math.round((Date.now() - st.lastAt) / 1000)) + ' s ago' : ''}` : ''}</div></div>
        <label class="row small" style="gap:4px"><input type="checkbox" data-on="${esc(i.id)}" ${i.on ? 'checked' : ''}> On</label>
        <button class="btn sm" data-edit="${esc(i.id)}">Settings</button></div>`;
    }).join('');
    $$('[data-on]', box || document).forEach((c) => c.onchange = () => saveInputs(data.settings.inputs.map((i) => (i.id === c.dataset.on ? { ...i, on: c.checked } : i))));
    $$('[data-edit]', box || document).forEach((b) => b.onclick = () => { editing = JSON.parse(JSON.stringify(data.settings.inputs.find((i) => i.id === b.dataset.edit))); paintEditor(); });
    const lines = $('#tm-lines');
    if (lines) {
      const names = Object.fromEntries(data.settings.inputs.map((i) => [i.id, i.name || i.id]));
      lines.innerHTML = data.recent.length ? `<table class="t"><tr><th>Time</th><th>From</th><th>Received</th><th>Read as</th></tr>${data.recent.slice().reverse().slice(0, 80).map((x) => `<tr><td class="muted small mono">${new Date(x.at).toLocaleTimeString('en-GB')}</td><td class="small">${esc(names[x.input] || x.input)}</td><td class="mono small" style="word-break:break-all">${esc(x.text)}</td><td class="small">${what(x.msg)}</td></tr>`).join('')}</table>`
        : '<p class="muted small">Nothing received yet. Lines appear here as soon as a timing system sends something.</p>';
    }
  }
  function wire() {
    $('#tm-add').onchange = (e) => {
      const p = PRESETS.find((x) => x.key === e.target.value);
      e.target.value = '';
      if (!p) return;
      editing = Object.assign({ id: Math.random().toString(36).slice(2, 8), on: true, mode: 'listen', host: '', port: 0, com: '', baud: 9600, parity: 'none', bits: 8, folder: '', rules: [], _new: true, _help: p.help }, JSON.parse(JSON.stringify(p.input)));
      paintEditor();
    };
    const opt = (id, k) => { $(id).onchange = (e) => saveSettings({ [k]: e.target.checked }); };
    opt('#tm-follow', 'follow'); opt('#tm-auto', 'autoCreate'); opt('#tm-clock', 'clock'); opt('#tm-fsl', 'followStartLists');
    const inputFor = () => { const id = $('#tm-tin').value; return id ? data.settings.inputs.find((i) => i.id === id) : { kind: 'udp', format: 'auto' }; };
    $('#tm-preview').onclick = async () => {
      try { const r = await api('POST', '/api/timing/preview', { input: inputFor(), text: $('#tm-text').value }); $('#tm-pv').innerHTML = r.lines.map((l) => `<div><span class="mono">${esc(l.text)}</span> → ${what(l.msg && (l.msg.entries || l.msg.rows) ? { t: l.msg.t, name: l.msg.name, entries: (l.msg.entries || l.msg.rows).length } : l.msg)}</div>`).join('') || '<span class="muted">Nothing to read</span>'; } catch (e) { CG.toast(e.message, 'err'); }
    };
    $('#tm-inject').onclick = async () => {
      const id = $('#tm-tin').value;
      try { const r = await api('POST', '/api/timing/inject', { input: id, text: $('#tm-text').value }); CG.toast(`Sent ${r.lines} line${r.lines === 1 ? '' : 's'}`, 'ok'); refresh(); } catch (e) { CG.toast(e.message, 'err'); }
    };
  }

  // ---------------------------------------------------------------- one timing system's settings
  async function paintEditor() {
    const box = $('#tm-edit');
    if (!box || !editing) { if (box) box.innerHTML = ''; return; }
    const i = editing;
    if (i.kind === 'serial' && !ports) { ports = []; api('GET', '/api/timing/ports').then((r) => { ports = r.ports; paintEditor(); }).catch(() => {}); }
    const sample = data.recent.filter((x) => x.input === i.id).slice(-30).reverse();
    box.innerHTML = `<div class="modal-back" id="tm-modal"><form class="modal" style="width:min(980px,96vw)" autocomplete="off"><h3>${i._new ? 'Add' : 'Settings:'} ${esc(i.name || 'timing system')}</h3><div class="modal-body">
      ${i._help ? `<p class="small muted" style="margin-top:0">${esc(i._help)}</p>` : ''}
      <div class="form-grid">
        <label class="f"><span>Name</span><input type="text" name="name" value="${esc(i.name || '')}"></label>
        <label class="f"><span>Connection</span>${sel('kind', KINDS, i.kind)}</label>
        <label class="f"><span>What it sends</span>${sel('format', FORMATS, i.format)}</label>
        ${i.kind === 'tcp' ? `<label class="f"><span>Who connects</span>${sel('mode', [['listen', 'The timing system connects to this PC'], ['connect', 'This PC connects to the timing system']], i.mode)}</label>` : ''}
        ${i.kind === 'tcp' && i.mode === 'connect' ? `<label class="f"><span>Timing system address</span><input type="text" name="host" value="${esc(i.host || '')}" placeholder="192.168.1.50"></label>` : ''}
        ${i.kind === 'tcp' || i.kind === 'udp' ? `<label class="f"><span>Port</span><input type="number" name="port" min="1" max="65535" list="tm-portlist" value="${esc(i.port || '')}"></label><datalist id="tm-portlist">${['5000', '5001', '5320', '5321', '5322', '1950', '1951', '4444', '9999'].map((p) => `<option value="${p}">`).join('')}</datalist>` : ''}
        ${i.kind === 'serial' ? `<label class="f"><span>COM port</span>${sel('com', [['', ports && ports.length ? 'Choose…' : 'No ports found'], ...(ports || []).map((p) => [p, p]), ...(i.com && !(ports || []).includes(i.com) ? [[i.com, i.com]] : [])], i.com)}</label>
          <label class="f"><span>Baud</span>${sel('baud', BAUDS, String(i.baud || 9600))}</label>
          <label class="f"><span>Parity</span>${sel('parity', [['none', 'None'], ['even', 'Even'], ['odd', 'Odd']], i.parity || 'none')}</label>
          <label class="f"><span>Data bits</span>${sel('bits', ['8', '7'], String(i.bits || 8))}</label>` : ''}
        ${i.kind === 'folder' ? `<label class="f" style="grid-column:span 2"><span>Folder on this PC (or a shared folder)</span><input type="text" name="folder" value="${esc(i.folder || '')}" placeholder="C:\\Lynx  or  \\\\PHOTOFINISH\\Lynx"></label>` : ''}
      </div>
      ${i.format === 'custom' || (i.rules && i.rules.length) ? rulesHtml(i, sample) : `<p class="small muted">Lines that are not understood can be read with your own rules: choose “My own layout”.</p>`}
      </div><div class="modal-actions">${i._new ? '' : '<button type="button" class="btn ghost danger" id="tm-del">Remove</button>'}<span class="grow"></span><button type="button" class="btn ghost" id="tm-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div></form></div>`;
    const form = $('#tm-modal form');
    const read = () => {
      const f = Object.fromEntries(new FormData(form).entries());
      Object.assign(editing, { name: f.name, kind: f.kind, format: f.format, mode: f.mode || editing.mode, host: f.host !== undefined ? f.host : editing.host, port: f.port !== undefined ? Number(f.port) || 0 : editing.port, com: f.com !== undefined ? f.com : editing.com, baud: Number(f.baud || editing.baud), parity: f.parity || editing.parity, bits: Number(f.bits || editing.bits), folder: f.folder !== undefined ? f.folder : editing.folder });
      editing.rules = $$('[data-rule]', form).map((r) => ({ when: $('[name=when]', r).value, match: $('[name=match]', r) ? $('[name=match]', r).value : '', type: $('[name=type]', r).value, split: $('[name=split]', r).value,
        fields: Object.fromEntries($$('[data-field]', r).filter((s) => s.value).map((s) => [s.dataset.field, Number(s.value)])) }));
    };
    $$('select[name=kind], select[name=format], select[name=mode]', form).forEach((s) => s.onchange = () => { read(); paintEditor(); });
    $$('[data-rule] select[name=type], [data-rule] select[name=split], [data-rule] select[name=when]', form).forEach((s) => s.onchange = () => { read(); paintEditor(); });
    const add = $('#tm-rule-add', form); if (add) add.onclick = () => { read(); editing.rules.push({ when: 'any', match: '', type: 'result', split: 'controls', fields: {} }); paintEditor(); };
    $$('[data-rdel]', form).forEach((b) => b.onclick = () => { read(); editing.rules.splice(Number(b.dataset.rdel), 1); paintEditor(); });
    $$('[data-rup]', form).forEach((b) => b.onclick = () => { read(); const k = Number(b.dataset.rup); if (k > 0) [editing.rules[k - 1], editing.rules[k]] = [editing.rules[k], editing.rules[k - 1]]; paintEditor(); });
    const smp = $('#tm-sample', form); if (smp) smp.onchange = () => { read(); editing._sample = smp.value; paintEditor(); };
    $('#tm-cancel').onclick = () => { editing = null; paintEditor(); };
    $('#tm-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'tm-modal') { editing = null; paintEditor(); } });
    const del = $('#tm-del'); if (del) del.onclick = async () => {
      if (!(await CG.modal('Remove timing system', `<p>Stop listening to ${esc(i.name || 'this timing system')} and remove its settings?</p>`, { ok: 'Remove', danger: true }))) return;
      const id = editing.id; editing = null; await saveInputs(data.settings.inputs.filter((x) => x.id !== id));
    };
    form.onsubmit = async (e) => {
      e.preventDefault(); read();
      const clean = Object.fromEntries(Object.entries(editing).filter(([k]) => !k.startsWith('_')));
      const list = data.settings.inputs.some((x) => x.id === clean.id) ? data.settings.inputs.map((x) => (x.id === clean.id ? clean : x)) : data.settings.inputs.concat([clean]);
      editing = null;
      await saveInputs(list);
    };
  }
  function rulesHtml(i, sample) {
    const cur = i._sample || (sample[0] && sample[0].text) || '';
    const cols = (split) => {
      const clean = cur.replace(/<[0-9a-f]{2}>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, '');
      const re = { controls: /\|/, comma: /,/, semicolon: /;/, tab: /\t/, pipe: /\|/, spaces: /\s{2,}|\t/, space: /\s+/ }[split] || /\|/;
      return clean ? clean.split(re).map((x) => x.trim()) : [];
    };
    return `<hr><h4 style="margin:6px 0">Your rules <span class="small muted" style="text-transform:none;letter-spacing:0">(the first rule that fits a line is used)</span></h4>
      <div class="row" style="margin-bottom:8px"><span class="small muted">Example line</span>${sel('sample', [['', sample.length ? 'Choose a received line…' : 'Nothing received yet: paste one in “Try it”'], ...sample.map((x) => [x.text, x.text.slice(0, 90)])], cur, 'id="tm-sample" style="max-width:640px"')}</div>
      ${(i.rules || []).map((r, k) => {
        const c = cols(r.split);
        const showMatch = r.when !== 'any';
        const fields = r.type === 'ignore' || r.type === 'start' ? [] : FIELDS.filter(([f]) => ({ clock: ['clock'], wind: ['wind'], event: ['event', 'wind', 'heat'], stop: ['clock'], entry: ['lane', 'bib', 'name', 'first', 'last', 'team'], result: ['place', 'lane', 'bib', 'name', 'first', 'last', 'team', 'time', 'reaction'] })[r.type].includes(f));
        return `<div data-rule class="panel" style="padding:10px;margin-bottom:8px;background:var(--panel2)">
          <div class="row" style="gap:6px;flex-wrap:wrap">${sel('when', WHENS, r.when, 'style="width:auto"')}${showMatch ? `<input type="text" name="match" value="${esc(r.match || '')}" style="width:150px" placeholder="text">` : ''}<span class="muted small">are</span>${sel('type', RULE_TYPES, r.type, 'style="width:auto"')}<span class="muted small">split by</span>${sel('split', SPLITS, r.split, 'style="width:auto"')}
            <span class="grow"></span><button type="button" class="btn sm ghost" data-rup="${k}" title="Earlier">↑</button><button type="button" class="btn sm ghost" data-rdel="${k}">✕</button></div>
          ${fields.length ? `<div class="form-grid" style="margin-top:6px">${fields.map(([f, l]) => `<label class="f"><span>${esc(l)}</span><select data-field="${f}">${COLS.map(([v, t]) => `<option value="${v}" ${String((r.fields || {})[f] || '') === v ? 'selected' : ''}>${esc(t)}${v && c[Number(v) - 1] !== undefined ? ' = ' + esc(String(c[Number(v) - 1]).slice(0, 18)) : ''}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
          ${c.length && fields.length ? `<div class="small muted" style="margin-top:4px">Example split: ${c.map((x, n) => `<span class="mono">${n + 1}:</span> ${esc(x)}`).join(' · ')}</div>` : ''}</div>`;
      }).join('')}
      <button type="button" class="btn sm" id="tm-rule-add">+ Rule</button>`;
  }

  async function saveInputs(list) { try { data = Object.assign(data, await api('PUT', '/api/timing', { inputs: list })); paint(); CG.toast('Timing saved', 'ok'); } catch (e) { CG.toast(e.message, 'err'); } }
  async function saveSettings(o) { try { data = Object.assign(data, await api('PUT', '/api/timing', o)); } catch (e) { CG.toast(e.message, 'err'); } }

  async function refresh() {
    try { data = await api('GET', '/api/timing'); } catch (e) { data = { cloud: e.message }; }
    if (editing) { paintLive(); return; }
    if (!$('#tm-inputs', root) || data.cloud) paint(); else paintLive();
  }
  window.RFPTimingUI = {
    show(el) { if (timer && root === el) return; root = el; if (!data) paint(); refresh(); clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 1500); },
    hide() { clearInterval(timer); timer = null; },
  };
  void h;
})();
