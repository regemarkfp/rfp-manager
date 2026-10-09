/* Settings → Connections: everything this production PC talks to. CasparCG, vMix, ATEM, HyperDeck, OBS, Bitfocus Companion,
   OSC, Art-Net, MIDI, X-keys and a Raspberry Pi GPIO box; input mappings (a key, note, GPI or OSC message runs actions);
   and the addresses Companion / a Stream Deck can call to drive RFP Manager. */
'use strict';
(() => {
  const EXTRA = {   // per kind: what the host field means, and the extra fields
    vmix: { host: 'Host / IP', help: 'vMix → Settings → Web Controller must be on.' },
    atem: { host: 'Switcher IP', help: 'The switcher\'s own address (ATEM Setup → Network).' },
    hyperdeck: { host: 'HyperDeck IP', help: 'Remote must be on (Setup → Remote).' },
    obs: { host: 'Host / IP', extra: [['password', 'Password', 'password']], help: 'OBS → Tools → WebSocket Server Settings: enable, port 4455, copy the password.' },
    companion: { host: 'Host / IP', help: 'Companion → Settings → Protocols: HTTP API on (port 8000). Buttons are page / row / column.' },
    osc: { host: 'Send to (IP)', extra: [['listen', 'Listen on port', 'number']], help: 'Messages go to the IP and port; with a listen port, OSC sent to this PC becomes live values.' },
    artnet: { host: 'Node IP (or 255.255.255.255)', extra: [['universe', 'Universe', 'number']], help: 'DMX over Art-Net: set channels and fades from buttons, cues and macros.' },
    midi: { host: 'Port name contains', noPort: true, extra: [['channel', 'Channel (0 = all)', 'number']], help: 'MIDI gear plugged into this PC. Leave the port name empty for every port, or pick one below. Close other programs that hold the port (some drivers allow only one).' },
    xkeys: { host: 'Name contains', noPort: true, help: 'X-keys plugged into this PC (any model). Leave the name empty for every X-keys, or pick one below.' },
    pigpio: { host: 'Pi address', help: 'tools/pi-gpio.py on the Pi (port 8095).' },
  };
  const WHAT = { vmix: 'Cut / OverlayInput1In …', atem: 'cut, dsk-on, key-on …', hyperdeck: 'record, stop, play …', obs: 'scene, stream-start, mute …', companion: 'press, set-variable', osc: '/eos/key/go_0', artnet: 'set, fade, blackout', midi: 'note, cc, pc', xkeys: 'light-on, light-off', pigpio: 'pulse, on, off, toggle' };
  const VAL = { vmix: 'Input=2&Duration=500', atem: 'input=2 me=1 key=1 dsk=1', hyperdeck: '', obs: 'Scene name  (source: Scene | Source)', companion: '1/0/2  or  myvar=hello', osc: '1 0.5 "text"', artnet: '1=255 2=128 10-12=50% time=2', midi: 'note=60 vel=127 ch=1  ·  cc=7 value=100', xkeys: 'key=5  (red=1 for the red bank)', pigpio: 'gpo=1 ms=200' };

  // ---------------------------------------------------------------- one action list editor for the main app
  // (input mappings, game triggers): macro, Timeline, graphics, device commands, variables, adverts, AMCP, each with a delay
  const ACT = { graphics: null, devices: null, vars: null };
  function loadActLists(then) {
    const jobs = [];
    if (!ACT.graphics) jobs.push(api('GET', '/live/api/variables').then((v) => { ACT.graphics = [...v.builtIn.map((g) => [g.id, g.name + ' (' + g.group + ')']), ...App.list('graphic').map((g) => ['tpl_' + g.id, g.data.name + ' (template)'])]; }).catch(() => { ACT.graphics = App.list('graphic').map((g) => ['tpl_' + g.id, g.data.name + ' (template)']); }));
    if (!ACT.devices) jobs.push((App.machine && App.machine.admin ? api('GET', '/api/connections').then((r) => { ACT.devices = r.devices; }) : Promise.reject(new Error('-'))).catch(() => { ACT.devices = []; }));
    if (!ACT.vars) jobs.push(api('GET', '/api/vars').then((r) => { ACT.vars = r.list; }).catch(() => { ACT.vars = []; }));
    if (jobs.length) Promise.all(jobs).then(then); return !jobs.length;
  }
  const macroList = () => { const out = [], seen = new Set(); const add = (list, where) => (list || []).forEach((m) => { if (m && !seen.has(m.id)) { seen.add(m.id); out.push([m.id, m.name + ' (' + where + ')']); } }); add((App.org() || {}).macros, 'team'); App.list('theme').forEach((t) => add(t.data.macros, t.data.name)); return out; };
  App.actionsMini = (acts, opts) => {
    opts = opts || {};
    const dirty = () => { if (opts.onChange) opts.onChange(); };
    const box = h('div', {});
    const DO = [['macro', 'run macro'], ['advert', 'play an advert'], ['playlist', 'start an ad playlist'], ['adstop', 'stop the adverts'], ['show', 'take graphic'], ['hide', 'take off graphic'], ['hideall', 'take everything off'], ['setvar', 'set a variable'], ['timeline', 'timeline'], ['device', 'device command'], ['amcp', 'AMCP command']];
    const sel = (a, k, list, none) => h('select', { onchange: (e) => { a[k] = e.target.value; dirty(); } }, [h('option', { value: '' }, none), ...list.map(([v, l]) => h('option', { value: v, selected: a[k] === v }, l))]);
    const paintA = () => box.replaceChildren(...acts.map((a, n) => h('div', { class: 'row', style: { marginTop: '6px' } },
      h('select', { style: { width: 'auto' }, onchange: (e) => { acts[n] = { do: e.target.value, target: '', method: e.target.value === 'timeline' ? 'go' : '', value: '', delay: a.delay || 0 }; dirty(); paintA(); } }, DO.map(([k, l]) => h('option', { value: k, selected: a.do === k }, l))),
      a.do === 'macro' ? sel(a, 'target', macroList(), 'choose a macro…') : null,
      a.do === 'advert' ? sel(a, 'target', App.list('advert').map((x) => [x.id, x.data.name + (x.data.sponsor ? ' · ' + x.data.sponsor : '')]), 'choose an advert…') : null,
      a.do === 'playlist' ? sel(a, 'target', App.list('playlist').map((x) => [x.id, x.data.name]), 'choose a playlist…') : null,
      a.do === 'timeline' ? [h('select', { style: { width: 'auto' }, onchange: (e) => { a.method = e.target.value; dirty(); } }, ['go', 'play', 'pause', 'stop', 'prev'].map((m) => h('option', { value: m, selected: a.method === m }, m.toUpperCase()))),
        h('select', { onchange: (e) => { a.target = e.target.value; dirty(); } }, [h('option', { value: '' }, 'the timeline that is running'), ...App.list('timeline').map((t) => h('option', { value: t.id, selected: a.target === t.id }, t.data.name))])] : null,
      a.do === 'show' || a.do === 'hide' ? sel(a, 'target', ACT.graphics || [], 'choose a graphic…') : null,
      a.do === 'show' ? h('input', { value: Object.entries(a.values || {}).map(([k, v]) => k + '=' + v).join('; '), placeholder: 'values: line1=TRY {team}; line2={event_text}', style: { flex: '1 1 220px' }, oninput: (e) => { a.values = {}; e.target.value.split(';').forEach((p) => { const m = /^\s*([^=]+?)\s*=\s*(.*)$/.exec(p); if (m) a.values[m[1]] = m[2]; }); dirty(); } }) : null,
      a.do === 'setvar' ? [sel(a, 'target', (ACT.vars || []).map((v) => [v.key, v.name + ' {var_' + v.key + '}']), 'choose a variable…'), h('input', { value: a.value || '', placeholder: '12 · +1 · toggle · {value} · text', style: { width: '190px' }, oninput: (e) => { a.value = e.target.value; dirty(); } })] : null,
      a.do === 'device' ? [sel(a, 'target', (ACT.devices || []).map((d) => [d.id, d.name]), 'choose a device…'),
        h('input', { value: a.method || '', placeholder: 'command', style: { width: '150px' }, oninput: (e) => { a.method = e.target.value; dirty(); } }), h('input', { value: a.value || '', placeholder: 'value', style: { width: '170px' }, oninput: (e) => { a.value = e.target.value; dirty(); } })] : null,
      a.do === 'amcp' ? h('input', { value: a.value || '', placeholder: 'PLAY 1-10 "STING"', style: { flex: '1 1 200px' }, oninput: (e) => { a.value = e.target.value; dirty(); } }) : null,
      h('span', { class: 'dim small' }, 'after'), h('input', { type: 'number', min: 0, step: 0.1, value: a.delay || 0, style: { width: '70px' }, oninput: (e) => { a.delay = Number(e.target.value) || 0; dirty(); } }), h('span', { class: 'dim small' }, 's'),
      h('button', { class: 'sm ghost', onclick: () => { acts.splice(n, 1); dirty(); paintA(); } }, '✕'))),
    h('button', { class: 'sm', style: { marginTop: '6px' }, onclick: () => { acts.push({ do: opts.first || 'macro', target: '', delay: 0 }); dirty(); paintA(); } }, '+ action'));
    if (loadActLists(paintA)) paintA(); else paintA();
    return box;
  };

  function connectionsTab() {
    const el = h('div', { class: 'stack' }, h('div', { class: 'card dim' }, 'Loading…'));
    let lastHw = null, C = null, devs = null, maps = null, dirtyDev = false, dirtyMap = false, timer = null, graphics = [];
    const lab = (t, input, help) => h('label', { class: 'f' }, h('span', {}, t), input, help ? h('div', { class: 'help' }, help) : null);
    const led = (on, warn) => h('span', { class: 'led ' + (on ? 'ok' : warn ? 'warn' : 'bad') });

    // ---------------- CasparCG
    function casparCard() {
      const s = C.caspar, f = { ...s.settings };
      const inp = (k, attrs = {}) => h('input', { value: f[k] === undefined || f[k] === null ? '' : f[k], ...attrs, oninput: (e) => { f[k] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; } });
      const pick = (k, opts) => h('select', { onchange: (e) => { f[k] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(f[k]) === v }, l)));
      const raw = h('input', { placeholder: 'AMCP command, e.g. INFO or CLEAR 1', onkeydown: (e) => { if (e.key === 'Enter') sendRaw(); } });
      const sendRaw = () => { if (!raw.value.trim()) return; api('POST', '/api/connections/caspar/raw', { command: raw.value.trim() }).then(() => toast('Sent')).catch(oops); raw.value = ''; };
      return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'CasparCG'), h('div', { class: 'row', id: 'cn-caspar' }, led(s.connected, !s.enabled), h('span', { class: 'dim' }, !s.enabled ? 'Off (browser outputs only)' : s.connected ? 'Connected · ' + (s.version || '') : 'Not connected · ' + s.endpoint))),
        h('div', { class: 'form' },
          lab('Send graphics to CasparCG', pick('enabled', [['true', 'Yes'], ['false', 'No (browser output only)']])),
          lab('Host / IP', inp('host')), lab('AMCP port', inp('port', { type: 'number' })),
          lab('Program channel', inp('programChannel', { type: 'number' })), lab('Preview channel', inp('previewChannel', { type: 'number' })),
          lab('Template data', pick('defaultFormat', [['json', 'JSON'], ['xml', 'XML (templateData)']])),
          lab('Images in templates', pick('images', [['file', 'File path from the image folder'], ['http', 'Web address from this app']]), 'Web address when CasparCG runs on another PC.'),
          lab('Default template folder', inp('templateFolder')),
          lab('Clear layer after OUT (ms)', inp('clearAfterStopMs', { type: 'number' }), '0 = never: OUT sends STOP so the template plays its out animation.')),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'primary', onclick: () => api('PUT', '/api/connections/caspar', { ...f, enabled: String(f.enabled) !== 'false' }).then((r) => { C = r; toast('CasparCG saved – reconnecting'); paint(); }).catch(oops) }, 'Save & reconnect'),
          h('button', { onclick: () => api('POST', '/api/connections/caspar/reconnect').then(() => toast('Reconnecting')).catch(oops) }, 'Reconnect'),
          h('div', { class: 'row grow', style: { flex: '1 1 260px' } }, raw, h('button', { onclick: sendRaw }, 'Send'))));
    }

    // ---------------- devices
    function deviceCard() {
      const K = C.kinds;
      const rows = devs.map((d, i) => {
        const x = EXTRA[d.type] || {}, live = C.devices.find((y) => y.id === d.id && y.type === d.type);
        const set = (k, v) => { d[k] = v; dirtyDev = true; saveBtn.disabled = false; };
        const field = (k, label, type, w) => h('label', { class: 'f', style: { flex: `1 1 ${w || 140}px` } }, h('span', {}, label), h('input', { type: type || 'text', value: d[k] === undefined || d[k] === null ? '' : d[k], placeholder: k === 'password' && live && live.password ? 'saved – leave as it is' : '', oninput: (e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value) }));
        return h('div', { class: 'conn-dev' },
          h('div', { class: 'row', style: { alignItems: 'center' } }, h('b', {}, K[d.type] ? K[d.type].name : d.type), h('span', { class: 'grow' }),
            h('span', { class: 'row small', 'data-st': d.id }, live ? [led(live.connected, live.enabled === false), h('span', { class: 'dim' }, live.enabled === false ? 'off' : live.connected ? (live.summary || 'connected') : (live.error || 'not connected'))] : h('span', { class: 'dim' }, 'not saved yet')),
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: d.enabled !== false, onchange: (e) => set('enabled', e.target.checked) }), ' On'),
            h('button', { class: 'sm ghost danger', title: 'Remove', onclick: () => { devs.splice(i, 1); dirtyDev = true; paint(); } }, '✕')),
          h('div', { class: 'row', style: { alignItems: 'flex-end', marginTop: '6px' } },
            field('name', 'Name', 'text', 130), field('id', 'Id (live values start with it)', 'text', 120),
            x.noHost ? null : field('host', x.host || 'Host / IP', 'text', 170),
            x.noPort ? null : field('port', 'Port', 'number', 80),
            (x.extra || []).map(([k, l, t]) => field(k, l, t, 110))),
          x.help ? h('div', { class: 'help' }, x.help) : null,
          (d.type === 'midi' || d.type === 'xkeys') && C.hw ? (() => {
            const found = d.type === 'midi' ? C.hw.midiIn.map((n) => [n, n]) : C.hw.hid.map((u) => [u.name, u.name + (u.pid ? ' (' + u.pid + ')' : '')]);
            const outs = d.type === 'midi' ? C.hw.midiOut : [];
            return h('div', { class: 'help', 'data-hw': d.type }, !C.hw.ok && C.hw.error ? h('span', { style: { color: 'var(--danger)' } }, C.hw.error + ' ') : null,
              found.length ? ['Found on this PC: ', found.map(([v, l]) => h('button', { class: 'sm ghost', title: 'Use only this one', onclick: () => { set('host', v); paint(); } }, l)), outs.length ? h('span', {}, ' · outputs: ' + outs.join(', ')) : null]
                : C.hw.ok ? (d.type === 'midi' ? 'No MIDI ports found on this PC yet.' : 'No X-keys found on this PC yet (plug it in; it shows here within a few seconds).') : null);
          })() : null);
      });
      const saveBtn = h('button', { class: 'primary', disabled: !dirtyDev, onclick: () => api('PUT', '/api/connections/devices', { list: devs }).then((r) => { C = r; devs = clone(r.devices); dirtyDev = false; toast('Devices saved – connecting'); paint(); }).catch(oops) }, 'Save & connect');
      const tryDev = h('select', {}, C.devices.map((d) => h('option', { value: d.id }, d.name)));
      const tryCmd = h('input', { placeholder: 'command', list: 'cn-cmds', style: { flex: '1 1 160px' } }), tryVal = h('input', { placeholder: 'value', style: { flex: '1 1 200px' } }), dl = h('datalist', { id: 'cn-cmds' });
      const fillCmds = () => { const d = C.devices.find((x) => x.id === tryDev.value); dl.replaceChildren(...((d && d.commands) || []).map((c) => h('option', { value: c }))); tryCmd.placeholder = d ? 'command, e.g. ' + (WHAT[d.type] || '') : 'command'; tryVal.placeholder = d ? 'value, e.g. ' + (VAL[d.type] || '') : 'value'; };
      tryDev.onchange = fillCmds; setTimeout(fillCmds, 0);
      const bridged = devs.some((d) => d.type === 'midi' || d.type === 'xkeys');
      return h('div', { class: 'card' }, h('h2', {}, 'Devices and software'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'Each one\'s state becomes live values (', h('code', {}, '<id>_streaming_time'), ', ', h('code', {}, '<id>_dsk1_onair'), ', ', h('code', {}, '<id>_program_scene'), ' …) for templates, triggers and the Timeline, and takes commands from scorer buttons, macros, graphic buttons and Timeline cues ("Device command").'),
        rows.length ? rows : h('p', { class: 'dim' }, 'Nothing added yet.'),
        h('div', { class: 'row', style: { marginTop: '10px' } }, Object.entries(K).map(([k, v]) => h('button', { class: 'sm', onclick: () => { const n = devs.filter((d) => d.type === k).length; devs.push({ type: k, name: v.name + (n ? ' ' + (n + 1) : ''), id: k + (n ? n + 1 : ''), host: v.bridged ? '' : v.host || '127.0.0.1', port: v.port, enabled: true }); dirtyDev = true; paint(); } }, '+ ' + v.name))),
        h('div', { class: 'row', style: { marginTop: '12px' } }, saveBtn, dirtyDev ? h('button', { class: 'ghost', onclick: () => { devs = clone(C.devices); dirtyDev = false; paint(); } }, 'Cancel') : null),
        bridged ? h('p', { class: 'help' }, 'MIDI and X-keys connect straight to this PC. Gear plugged into another computer can come in through the ', h('a', { href: '/live/bridge.html', target: '_blank' }, 'hardware bridge page ↗'), ' opened there in Chrome or Edge (from this PC\'s address with https or on that computer\'s own localhost).') : null,
        C.devices.length ? h('div', {}, h('div', { class: 'flabel', style: { marginTop: '14px' } }, 'Try a command'), h('div', { class: 'row' }, tryDev, tryCmd, dl, tryVal,
          h('button', { onclick: () => api('POST', '/api/connections/command', { id: tryDev.value, command: tryCmd.value.trim(), value: tryVal.value.trim() }).then(() => toast('Sent')).catch(oops) }, 'Send'))) : null);
    }

    // ---------------- input mappings: when a device value changes, run actions
    const actionsMini = (acts) => App.actionsMini(acts, { onChange: () => { dirtyMap = true; } });
    // Learn: the next key, pad, note, GPI or OSC message
    function learnInto(btn, done) {
      const was = btn.textContent; btn.textContent = 'Press it now…'; btn.disabled = true; btn.classList.add('primary');
      api('POST', '/api/connections/learn').then((r) => {
        if (!r.input) { toast('Nothing was pressed. Is the device added above and connected (green)?', 'error'); return; }
        toast(`Learnt ${r.input.key}${r.input.value && r.input.value !== '1' ? ' (' + r.input.value + ')' : ''} from ${r.input.device}`); done(r.input);
      }).catch(oops).finally(() => { btn.textContent = was; btn.disabled = false; btn.classList.remove('primary'); });
    }
    function mappingCard() {
      const keys = h('datalist', { id: 'cn-keys' });
      api('GET', '/live/api/variables').then((v) => { keys.replaceChildren(...v.vars.filter((x) => x.group.startsWith('Devices')).map((x) => h('option', { value: x.key }, x.note || x.group))); graphics = [...v.builtIn.map((g) => [g.id, g.name + ' (' + g.group + ')']), ...App.list('graphic').map((g) => ['tpl_' + g.id, g.data.name + ' (template)'])]; }).catch(() => {});
      return h('div', { class: 'card' }, h('h2', {}, 'Input mappings'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'A button on an X-keys, a MIDI note, a GPI on the Pi, an OSC message, a tally from the ATEM… runs actions: a macro, Timeline GO, a graphic, a device command. Pick the live value (e.g. ', h('code', {}, 'xkeys_key5'), ', ', h('code', {}, 'midi_note60'), ', ', h('code', {}, 'pi_gpi1'), ', ', h('code', {}, 'osc_go'), ').'),
        keys,
        maps.length ? maps.map((m, i) => h('div', { class: 'conn-dev' },
          h('div', { class: 'row', style: { alignItems: 'flex-end' } },
            h('label', { class: 'f', style: { flex: '1 1 200px' } }, h('span', {}, 'When'), h('input', { value: m.when || '', list: 'cn-keys', placeholder: 'xkeys_key5', 'data-when': i, oninput: (e) => { m.when = e.target.value; dirtyMap = true; } })),
            h('button', { title: 'Press the key, pad, note or button you want to use, within 15 seconds', onclick: (e) => learnInto(e.currentTarget, (x) => { m.when = x.key; dirtyMap = true; if (!m.label) m.label = x.device + ' ' + x.key.replace(/^[^_]+_/, ''); paint(); }) }, '◉ Learn'),
            h('label', { class: 'f', style: { flex: '0 1 170px' } }, h('span', {}, 'Happens'), h('select', { onchange: (e) => { m.on = e.target.value; dirtyMap = true; paint(); } }, [['press', 'is pressed / turns on'], ['release', 'is let go / turns off'], ['change', 'changes'], ['equals', 'becomes …']].map(([v, l]) => h('option', { value: v, selected: m.on === v }, l)))),
            m.on === 'equals' ? h('label', { class: 'f', style: { flex: '0 1 120px' } }, h('span', {}, 'Value'), h('input', { value: m.value || '', oninput: (e) => { m.value = e.target.value; dirtyMap = true; } })) : null,
            h('label', { class: 'f', style: { flex: '1 1 150px' } }, h('span', {}, 'Label'), h('input', { value: m.label || '', placeholder: 'GO button', oninput: (e) => { m.label = e.target.value; dirtyMap = true; } })),
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !m.off, onchange: (e) => { m.off = !e.target.checked; dirtyMap = true; } }), ' On'),
            h('button', { class: 'sm ghost danger', onclick: () => { maps.splice(i, 1); dirtyMap = true; paint(); } }, '✕')),
          actionsMini(m.actions = m.actions || []))) : h('p', { class: 'dim' }, 'No mappings yet.'),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { onclick: () => { maps.push({ when: '', on: 'press', label: '', actions: [{ do: 'timeline', method: 'go', target: '', delay: 0 }] }); dirtyMap = true; paint(); } }, '+ Mapping'),
          h('button', { title: 'Press a key, pad, note or button: a new mapping for it', onclick: (e) => learnInto(e.currentTarget, (x) => { maps.push({ when: x.key, on: 'press', label: x.device + ' ' + x.key.replace(/^[^_]+_/, ''), actions: [{ do: 'macro', target: '', delay: 0 }] }); dirtyMap = true; paint(); }) }, '◉ Learn a new one'),
          h('button', { class: 'primary', onclick: () => api('PUT', '/api/connections/mappings', { list: maps }).then((r) => { C = r; maps = clone(r.mappings); dirtyMap = false; toast('Mappings saved'); paint(); }).catch(oops) }, 'Save mappings')));
    }

    // ---------------- Companion / Stream Deck → RFP Manager
    function remoteCard() {
      const base = `http://${(C.hostname || 'pc-name').toLowerCase()}:${C.port}/live/api/companion`, k = '?key=' + C.outputKey;
      const line = (path, what) => h('tr', {}, h('td', {}, h('code', { style: { wordBreak: 'break-all' } }, base + path)), h('td', { class: 'dim' }, what));
      return h('div', { class: 'card' }, h('h2', {}, 'Control RFP Manager from Companion or a Stream Deck'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'In Companion add a "Generic HTTP" connection and use these addresses (GET or POST). On this PC no key is needed; from another machine add ', h('code', {}, k), ' to each address.'),
        h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {},
          line('/macro/<macro name>', 'run a macro'), line('/timeline/go', 'Timeline GO (also play, pause, stop, prev; add /<timeline id> for a particular one)'),
          line('/take/<graphic id>', 'take a graphic'), line('/out/<graphic id>', 'take a graphic off'), line('/hideall', 'take everything off'),
          line('/device/<device id>/<command>?value=…', 'a device command'), line('/values', 'every live value as JSON (for Companion variables)')))),
        h('div', { class: 'help' }, 'Screen key: ', h('code', {}, C.outputKey)));
    }

    function paint() {
      el.replaceChildren(casparCard(), deviceCard(), mappingCard(), remoteCard());
    }
    // status every 2 s, without touching what is being typed
    function refresh() {
      api('GET', '/api/connections').then((r) => {
        C = Object.assign(C || {}, r);
        if (!devs) { devs = clone(r.devices); maps = clone(r.mappings); paint(); return; }
        const cs = el.querySelector('#cn-caspar'); if (cs) cs.replaceChildren(led(r.caspar.connected, !r.caspar.enabled), h('span', { class: 'dim' }, !r.caspar.enabled ? 'Off (browser outputs only)' : r.caspar.connected ? 'Connected · ' + (r.caspar.version || '') : 'Not connected · ' + r.caspar.endpoint));
        const hwSig = JSON.stringify(r.hw || null);
        if (hwSig !== lastHw) { const first = lastHw === null; lastHw = hwSig; const busy = document.activeElement && el.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName); if (!first && !busy && devs.some((d) => d.type === 'midi' || d.type === 'xkeys')) { paint(); return; } }
        for (const d of r.devices) { const sEl = el.querySelector(`[data-st="${CSS.escape(d.id)}"]`); if (sEl) sEl.replaceChildren(led(d.connected, d.enabled === false), h('span', { class: 'dim' }, d.enabled === false ? 'off' : d.connected ? (d.summary || 'connected') : (d.error || 'not connected'))); }
      }).catch((e) => { if (!devs) el.replaceChildren(h('div', { class: 'card' }, e.message)); });
    }
    const clone = (x) => JSON.parse(JSON.stringify(x || []));
    refresh();
    timer = setInterval(() => { if (!document.body.contains(el)) { clearInterval(timer); return; } refresh(); }, 2000);
    return el;
  }
  App.connectionsTab = connectionsTab;
})();
