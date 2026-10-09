'use strict';
// Who did it: the screen, person and address behind whatever happens next (a take, an OUT, an advert), carried through
// async calls and timers, so the play log can say "Graphics control · Ruan · 100.64.0.7" or "Timeline · Half-time show".
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();
const run = (who, fn) => als.run(Object.assign({ name: '', ip: '', via: '' }, who || {}), fn);
const who = () => als.getStore() || null;
// a new layer on top of what is there (keeps the person and address, says how)
const also = (more, fn) => run(Object.assign({}, who() || {}, more), fn);
module.exports = { run, who, also };
