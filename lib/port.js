'use strict';
// When the port is taken at start-up: find out who has it. An older RFP Manager that was left running (a window that was
// closed without stopping it, a copy started from another folder) is stopped so this one can take over. Anything else is named.
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 6000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/config', timeout: 1500 }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 20000) body += c; });
      res.on('end', () => { try { const j = JSON.parse(body); resolve(j && typeof j.version === 'string' && 'mode' in j ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function holders(port) {
  const out = new Map();
  if (process.platform === 'win32') {
    for (const line of run('netstat', ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
      if (m && Number(m[1]) === Number(port)) out.set(Number(m[2]), '');
    }
    for (const pid of out.keys()) { const m = /^"([^"]+)"/.exec(run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).trim()); out.set(pid, m ? m[1] : ''); }
  } else {
    for (const p of run('lsof', ['-nP', '-ti', `tcp:${port}`, '-sTCP:LISTEN']).split(/\s+/).filter(Boolean)) out.set(Number(p), run('ps', ['-p', p, '-o', 'comm=']).trim());
  }
  out.delete(process.pid);
  return [...out].map(([pid, name]) => ({ pid, name }));
}

function kill(pid) {
  if (process.platform === 'win32') run('taskkill', ['/PID', String(pid), '/F']);
  else { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}

// → { freed: true, version } when an older RFP Manager was stopped, else { freed: false, who: 'chrome.exe (PID 1234)' | '' }
async function freePort(port) {
  const other = await probe(port), list = holders(port);
  const who = list.map((h) => `${h.name || 'a program'} (PID ${h.pid})`).join(', ');
  if (!other) return { freed: false, who, rfp: false };
  const nodes = list.filter((h) => /node/i.test(h.name));
  if (!nodes.length) return { freed: false, who, rfp: true, version: other.version };
  for (const h of nodes) kill(h.pid);
  for (let i = 0; i < 20; i++) { await sleep(250); if (!holders(port).length) return { freed: true, version: other.version }; }
  return { freed: false, who, rfp: true, version: other.version };
}

module.exports = { freePort, probe, holders };
