/* Notifications for one person, on the website: the inbox, and the settings (what to get, quiet hours, the devices).
 * Plain DOM so both the Studio (/app) and the public website use it: RFPNotifyUI.inbox(el), RFPNotifyUI.settings(el).
 * In the Android app, the page also asks the app for its push token (window.RFPNative) and registers it. */
'use strict';
(() => {
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k === 'checked') e.checked = !!v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const x of kids.flat(Infinity)) if (x !== null && x !== undefined && x !== false) e.append(x);
    return e;
  };
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'x-rfp': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
    return j;
  };
  const say = (t, bad) => { if (window.toast) window.toast(t, bad ? 'error' : undefined); else if (bad) alert(t); };
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const css = `.rn-list{display:grid;gap:2px}.rn-item{display:grid;grid-template-columns:10px 1fr auto;gap:10px;align-items:start;padding:10px 12px;border-radius:8px;text-decoration:none;color:inherit;border:1px solid transparent}
.rn-item:hover{background:rgba(127,127,127,.12)}.rn-item .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;background:transparent}.rn-item.unread .dot{background:var(--accent,#00ff82)}
.rn-item b{display:block}.rn-item .sub{opacity:.75;font-size:13px}.rn-item .when{opacity:.6;font-size:12px;white-space:nowrap}
.rn-group{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}.rn-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(127,127,127,.2)}
.rn-row input[type=checkbox]{width:18px;height:18px;flex:none}.rn-row span{flex:1}.rn-dev{display:flex;gap:10px;align-items:center;padding:6px 0}.rn-dev span{flex:1}
.rn-q{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rn-q input[type=time]{width:auto}.rn-note{opacity:.75;font-size:13px;margin:6px 0}`;
  let styled = false;
  const style = () => { if (styled) return; styled = true; document.head.append(el('style', {}, css)); };

  // ---- the Android app: its push token, registered for the signed-in person
  const native = window.RFPNative;
  async function registerApp() {
    if (!native || !native.pushToken) return false;
    const token = native.pushToken();
    if (!token) return false;
    try { await call('POST', '/api/push/register', { platform: 'android', token, name: native.deviceName ? native.deviceName() : 'Android' }); return true; } catch (e) { return false; }
  }
  // the app calls this when Firebase gives it a (new) token
  window.rfpPushToken = () => registerApp();
  // signed in in the app: register (quietly) once per page load
  if (native) fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.ok && registerApp()).catch(() => {});

  // ---- the rest of what the phone does for the website, in the app
  if (native) {
    // sharing and vibration through Android (the WebView has neither)
    if (!navigator.share && native.share) navigator.share = (d = {}) => { native.share(d.title || '', d.text || '', d.url || location.href); return Promise.resolve(); };
    if (native.vibrate) navigator.vibrate = (p) => { const ms = Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : Number(p) || 0; if (ms > 0) native.vibrate(ms); return true; };
    // keep the screen on while scoring, directing or watching
    const awake = () => { if (native.keepAwake) native.keepAwake(/^#\/(score|control|monitors|rundown|streamads|streams)\b/.test(location.hash) || /^\/watch\//.test(location.pathname)); };
    window.addEventListener('hashchange', awake); awake();
  }

  async function inbox(box, { limit } = {}) {
    style();
    box.replaceChildren(el('div', { class: 'rn-note' }, 'Loading…'));
    let d;
    try { d = await call('GET', '/api/notifications'); } catch (e) { box.replaceChildren(el('p', { class: 'rn-note' }, e.status === 401 ? 'Sign in to see your notifications.' : e.message)); return null; }
    const list = d.list.slice(0, limit || 60);
    box.replaceChildren(
      list.length ? el('div', { class: 'rn-list' }, list.map((n) => el('a', { class: 'rn-item' + (n.read ? '' : ' unread'), href: n.url || '#', onclick: () => { if (!n.read) call('POST', '/api/notifications/read', { ids: [n.id] }).catch(() => {}); } },
        el('span', { class: 'dot' }), el('div', {}, el('b', {}, n.title), n.body ? el('div', { class: 'sub' }, n.body) : null), el('span', { class: 'when' }, ago(n.at)))))
        : el('p', { class: 'rn-note' }, 'Nothing yet. Notifications about your streams, productions and matches show up here (and on your phone with the RFP Manager app).'),
      d.unread ? el('p', {}, el('button', { class: 'btn sm', onclick: async () => { await call('POST', '/api/notifications/read', { all: true }); inbox(box, { limit }); if (window.rfpUnread) window.rfpUnread(0); } }, 'Mark all as read')) : null);
    if (window.rfpUnread) window.rfpUnread(d.unread);
    return d;
  }

  async function settings(box) {
    style();
    box.replaceChildren(el('div', { class: 'rn-note' }, 'Loading…'));
    let d;
    try { d = await call('GET', '/api/push/prefs'); } catch (e) { box.replaceChildren(el('p', { class: 'rn-note' }, e.status === 401 ? 'Sign in to choose your notifications.' : e.message)); return; }
    const prefs = { ...d.prefs }, quiet = { ...d.quiet };
    const save = async (body) => { try { await call('PUT', '/api/push/prefs', body); } catch (e) { say(e.message, true); } };
    const groups = [...new Set(d.events.map((e) => e.group))];
    const qFrom = el('input', { type: 'time', value: quiet.from || '22:00', onchange: (e) => { quiet.from = e.target.value; save({ quiet }); } });
    const qTo = el('input', { type: 'time', value: quiet.to || '07:00', onchange: (e) => { quiet.to = e.target.value; save({ quiet }); } });
    const devices = el('div', {});
    const paintDevices = (list) => devices.replaceChildren(list.length ? list.map((x) => el('div', { class: 'rn-dev' }, el('span', {}, (x.platform === 'android' ? '📱 ' : '🖥 ') + x.name),
      el('button', { class: 'btn sm ghost', onclick: async () => { try { await call('DELETE', '/api/push/devices/' + x.id); paintDevices(list.filter((y) => y.id !== x.id)); } catch (e) { say(e.message, true); } } }, 'Remove')))
      : el('p', { class: 'rn-note' }, 'No phone or PC gets your notifications yet. Install the RFP Manager app for Android and sign in, or sign in on a production PC with RFP Manager for Windows.'));
    paintDevices(d.devices);
    box.replaceChildren(
      el('p', { class: 'rn-note' }, 'Choose what reaches your phone (RFP Manager for Android) and your production PC (RFP Manager for Windows). Everything also stays in your inbox here.'),
      native && !d.devices.some((x) => x.platform === 'android') ? el('p', {}, el('button', { class: 'btn primary', onclick: async () => { if (native.askPermission) native.askPermission(); setTimeout(async () => { if (await registerApp()) settings(box); else say('Allow notifications for RFP Manager, then try again', true); }, 1500); } }, 'Get notifications on this phone')) : null,
      groups.map((g) => [el('div', { class: 'rn-group' }, g), d.events.filter((e) => e.group === g).map((e) => el('label', { class: 'rn-row' },
        el('input', { type: 'checkbox', checked: prefs[e.key], onchange: (ev) => { prefs[e.key] = ev.target.checked; save({ prefs: { [e.key]: ev.target.checked } }); } }), el('span', {}, e.label)))]),
      el('div', { class: 'rn-group' }, 'Quiet hours'),
      el('div', { class: 'rn-q' }, el('label', { class: 'rn-row', style: { border: 0 } }, el('input', { type: 'checkbox', checked: quiet.on, onchange: (e) => { quiet.on = e.target.checked; save({ quiet }); } }), el('span', {}, 'No sound or pop-ups from')), qFrom, el('span', {}, 'to'), qTo),
      el('p', { class: 'rn-note' }, 'During quiet hours notifications only go to your inbox.'),
      el('div', { class: 'rn-group' }, 'Your devices'), devices,
      native ? el('p', { class: 'rn-q' },
        native.openNotificationSettings ? el('button', { class: 'btn sm ghost', onclick: () => native.openNotificationSettings() }, 'Sound and pop-ups on this phone…') : null,
        native.checkForUpdate ? el('button', { class: 'btn sm ghost', onclick: () => native.checkForUpdate() }, 'Check for app updates') : null,
        native.appVersion ? el('span', { class: 'rn-note' }, 'RFP Manager ' + native.appVersion()) : null) : null,
      el('p', {}, el('button', { class: 'btn sm', onclick: async () => { try { const r = await call('POST', '/api/push/test', {}); say(r.devices ? `Sent to ${r.pushed} of ${r.devices} device${r.devices === 1 ? '' : 's'}` : 'Sent to your inbox (no devices yet)'); } catch (e) { say(e.message, true); } } }, 'Send me a test notification')));
  }

  window.RFPNotifyUI = { inbox, settings, registerApp, unread: async () => { try { return (await call('GET', '/api/notifications')).unread; } catch (e) { return 0; } } };
})();
