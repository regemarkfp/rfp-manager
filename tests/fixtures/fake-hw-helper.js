'use strict';
// Stands in for tools/rfp-hw.ps1 in the tests: same lines in and out.
const fs = require('node:fs');
const log = process.argv[2];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ t: 'ports', midiIn: ['nanoPAD2', 'Launchpad Mini'], midiOut: ['nanoPAD2', 'Launchpad Mini'], hid: [{ id: 'h1', name: 'XK-24', pid: 1029, in: 33, out: 36 }] });
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    fs.appendFileSync(log, line + '\n');
    const [cmd, a, b] = line.split('\t');
    // test hooks: make the "hardware" send something
    if (cmd === 'fake-midi') out({ t: 'midi', port: a, d: b.split(' ').map(Number) });
    if (cmd === 'fake-hid') out({ t: 'hid', id: a, d: b.split(' ').map(Number) });
  }
});
process.stdin.on('end', () => process.exit(0));
