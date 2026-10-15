'use strict';
// Comments on the watch pages: a live chat while a stream is live, and comments on each video (a recording or a
// match video). Anyone who may watch can read them; signing in is needed to write one. Whoever wrote a comment,
// and members of the channel's or the production's team, can remove it.
// Kept as "comment" records outside the teams (team ''): { thread, slug, userId, name, image, text, at }
const { newId, fail } = require('./util');

const MAX_LEN = 500;
const SHOWN = 200;

function makeComments(app) {
  const last = new Map();                       // user id → time of their last comment (slow down floods)
  const threadOf = (slug, { match, start } = {}) => slug + ':' + (match ? 'm:' + match : start ? 'v:' + start : 'live');
  const clean = (t) => String(t || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, MAX_LEN);

  async function access(slug, user) {
    const s = await app.streaming.streamOf(slug);
    if (!s || s.ch.data.disabled) fail(404, 'There is no stream at this address');
    const member = user ? !!((await app.auth.roleIn(user, s.ch.team)) || (await app.auth.roleIn(user, s.prod.team))) : false;
    if ((s.ch.data.access || 'Public') !== 'Public' && !member) fail(403, 'Comments on this channel are for its viewers');
    return { ...s, member };
  }

  async function list(slug, where, user) {
    const { member } = await access(slug, user);
    const thread = threadOf(slug, where);
    const all = (await app.store.find('comment', 'thread', thread)).sort((a, b) => (a.data.at || 0) - (b.data.at || 0)).slice(-SHOWN);
    return { thread, signedIn: !!user, canModerate: member, comments: all.map((c) => ({ id: c.id, name: c.data.name, image: c.data.image || '', text: c.data.text, at: c.data.at, mine: !!user && c.data.userId === user.id })) };
  }

  async function add(slug, where, user, text) {
    if (!user) fail(401, 'Sign in to comment');
    await access(slug, user);
    const t = clean(text);
    if (!t) fail(400, 'Write something first');
    const prev = last.get(user.id) || 0;
    if (Date.now() - prev < 3000) fail(429, 'Slow down a little');
    last.set(user.id, Date.now());
    if (last.size > 20000) last.clear();
    const doc = await app.save('', 'comment', newId('cmt_'), { thread: threadOf(slug, where), slug, userId: user.id, name: user.data.name || String(user.data.email).split('@')[0], image: user.data.image || '', text: t, at: Date.now() }, user.id);
    return { id: doc.id, name: doc.data.name, image: doc.data.image, text: doc.data.text, at: doc.data.at, mine: true };
  }

  async function remove(id, user) {
    if (!user) fail(401, 'Sign in first');
    const c = await app.store.get(id);
    if (!c || c.deleted || c.type !== 'comment') fail(404, 'Comment not found');
    if (c.data.userId !== user.id) { const { member } = await access(c.data.slug, user); if (!member) fail(403, 'You can only remove your own comments'); }
    await app.put({ ...c, deleted: true, updatedAt: Math.max(Date.now(), c.updatedAt + 1), updatedBy: user.id });
    return {};
  }

  return { list, add, remove, threadOf };
}

module.exports = { makeComments };
