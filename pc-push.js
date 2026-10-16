'use strict';
// On a production PC (linked to the website): the people who sign in here get their push notifications as Windows
// notifications. The PC registers them with the website (machine key) and keeps one stream open
// (GET /api/push/stream); each notification is handed to RFP Manager.exe as a line "@@NOTIFY {json}" on the console,
// which shows it as a Windows notification (and opens the page when it is clicked).
const os = require('node:os');
const { log } = require('./util');

function makePcPush(app) {
  if (!app.isLocal || !app.sync) return { stop() {} };
  let stopped = false, ctrl = null, wait = 2000, timer = null;
  const KEY = 'push:pcusers';
  const name = () => `${os.hostname()} (Windows)`;

  async function users() { return (await app.store.kvGet(KEY).catch(() => null)) || []; }
  async function register(email) {
    if (!app.sync.linked() || !email) return;
    try { await app.sync.call('POST', '/api/push/register', { platform: 'windows', email, name: name() }); } catch (e) { log('Notifications on this PC:', e.message); }
  }
  // someone signed in on this PC: their notifications come here from now on (until they switch it off)
  app.on('signin', async (userId) => {
    const u = await app.store.get(userId).catch(() => null);
    if (!u || u.deleted || !u.data.email) return;
    const list = await users();
    if (!list.includes(u.data.email)) { list.push(u.data.email); await app.store.kvSet(KEY, list.slice(-50)); }
    register(u.data.email);
  });

  async function connect() {
    if (stopped) return;
    if (!app.sync.linked()) { timer = setTimeout(connect, 30000); timer.unref(); return; }
    const { base, key } = app.sync.creds();
    ctrl = new AbortController();
    try {
      for (const e of await users()) await register(e);
      const r = await fetch(base + '/api/push/stream', { headers: { authorization: 'Bearer ' + key, accept: 'text/event-stream' }, signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error('the website answered ' + r.status);
      wait = 2000;
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (!/^event: notify/m.test(block) || !data) continue;
          try {
            const n = JSON.parse(data);
            // the website's page, opened in RFP Manager on this PC when it is the Studio
            const hash = /\/app\/(#.*)$/.exec(n.url || '');
            const out = { title: n.title, body: n.body || '', url: hash ? '/' + hash[1] : n.url || '', kind: n.kind || '' };
            process.stdout.write('@@NOTIFY ' + JSON.stringify(out) + '\n');
            app.emit('pcnotify', out);
          } catch { /* not for us */ }
        }
      }
      throw new Error('closed');
    } catch (e) {
      if (stopped) return;
      if (e.name !== 'AbortError' && wait >= 30000) log('Notifications on this PC: ' + e.message + ' (trying again)');
      wait = Math.min(wait * 2, 60000);
      timer = setTimeout(connect, wait); timer.unref();
    }
  }
  timer = setTimeout(connect, 5000); timer.unref();
  return { stop() { stopped = true; clearTimeout(timer); if (ctrl) ctrl.abort(); }, users };
}

module.exports = { makePcPush };
