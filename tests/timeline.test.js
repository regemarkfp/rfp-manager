'use strict';
// Timeline: tracks and cues against time, run from the production PC; cues fire their actions, holds wait for GO.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, seed, liveClient, fakeCaspar, payload, sleep } = require('./helpers');

async function world(t) {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  const put = async (type, id, data) => { const r = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  return { app, c, cg, team, put };
}
const last = (lc, pred) => [...lc.got].reverse().find((m) => m.type === 'tl' && pred(m));

test('timeline: edit, run, cues fire their actions, holds wait for GO, crew follow and comment', async (t) => {
  const { app, c, cg, team, put } = await world(t);
  await put('timeline', 'timeline_show', { name: 'Half-time show', length: 30, bpm: 120 });
  const lc = await liveClient(app, { cookie: c.cookie(), role: 'timeline' });
  t.after(() => lc.close());
  await lc.send('tl', 'open', { id: 'timeline_show' });
  let m = last(lc, (x) => x.doc);
  assert.equal(m.doc.name, 'Half-time show');
  assert.deepEqual([m.can.edit, m.can.run, m.can.comment, m.run.state], [true, true, true, 'stopped']);
  // tracks and cues; a cue on a track that does not exist is dropped, an unknown action is dropped
  await lc.send('tl', 'save', { id: 'timeline_show', data: { name: 'Half-time show', length: 30, bpm: 120, beatsPerBar: 4,
    tracks: [{ id: 'trk_g', name: 'Graphics', kind: 'graphics' }, { id: 'trk_l', name: 'Lights', kind: 'lights', armed: false }],
    sections: [{ id: 's1', at: 0, label: 'Walk-in' }, { id: 's2', at: 1, label: 'Song 1', bpm: 90 }],
    cues: [
      { id: 'c1', track: 'trk_g', at: 0.3, label: 'Title', actions: [{ do: 'show', target: 'custom_lt', values: { line1: '{cue_label}', line2: '{section}' } }, { do: 'explode' }] },
      { id: 'c2', track: 'trk_g', at: 0.8, label: 'Wait for the band', kind: 'hold', actions: [{ do: 'hide', target: 'custom_lt' }] },
      { id: 'c3', track: 'trk_l', at: 0.5, label: 'Lights (track off)', actions: [{ do: 'show', target: 'custom_fs', values: { title: 'NO' } }] },
      { id: 'c4', track: 'nope', at: 1, label: 'lost' },
    ] } });
  const saved = (await app.store.get('timeline_show')).data;
  assert.deepEqual(saved.cues.map((x) => x.id), ['c1', 'c3', 'c2']);
  assert.deepEqual(saved.cues[0].actions.map((a) => a.do), ['show']);
  await until(() => last(lc, (x) => x.doc && x.doc.cues && x.doc.cues.length === 3), 2000, 'doc pushed to the screen');
  // run: the first cue fires, the hold stops the playhead, GO releases it and fires the hold cue
  cg.got.length = 0;
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'play' });
  let d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/lowerthird"')), 3000, 'cue 1'));
  assert.deepEqual([d.line1, d.line2], ['Title', 'Walk-in']);
  await until(() => last(lc, (x) => x.run && x.run.state === 'held'), 3000, 'hold');
  assert.equal(last(lc, (x) => x.run).run.holdId, 'c2');
  assert.ok(!cg.got.some((l) => l.includes('fullframe')), 'a cue on a track that is not armed does not fire');
  assert.equal(app.timeline.vars().timeline_section, 'Walk-in');
  assert.equal(app.timeline.vars().timeline_state, 'held');
  await sleep(300);
  assert.ok(!cg.got.some((l) => l.startsWith('CG 1-30 STOP')), 'nothing happens while held');
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'go' });
  await until(() => cg.got.some((l) => l.startsWith('CG 1-30 STOP')), 2000, 'hold cue fired on GO');
  await until(() => app.timeline.vars().timeline_section === 'Song 1', 2000, 'playhead runs on');
  // GO with no hold: jumps to the next cue on an armed track (none left) → error; seek back and GO fires cue 1 again
  await assert.rejects(lc.send('tl', 'run', { id: 'timeline_show', cmd: 'go' }), /No cue after the playhead/);
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'seek', pos: 0 });
  cg.got.length = 0;
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'go' });
  await until(() => cg.got.some((l) => /CG 1-30 (ADD|UPDATE)/.test(l)), 2000, 'GO fires the next cue');
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'pause' });
  assert.equal(last(lc, (x) => x.run).run.state, 'paused');
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'stop' });
  assert.deepEqual([last(lc, (x) => x.run).run.state, last(lc, (x) => x.run).run.pos], ['stopped', 0]);
  // a cue can be tried on its own
  cg.got.length = 0;
  await lc.send('tl', 'run', { id: 'timeline_show', cmd: 'fire', cue: 'c3' });
  await until(() => cg.got.some((l) => l.includes('fullframe')), 2000, 'fire one cue');
  // crew screen opened with the screen key follows the timeline started last, view only
  const crew = await liveClient(app, { key: app.config.outputKey, role: 'timeline' });
  t.after(() => crew.close());
  await crew.send('tl', 'open', {});
  m = last(crew, (x) => x.doc);
  assert.equal(m.id, 'timeline_show');
  assert.deepEqual([m.can.edit, m.can.run, m.follow], [false, false, true]);
  await assert.rejects(crew.send('tl', 'run', { id: 'timeline_show', cmd: 'play' }), /view-only/);
  // comments at a moment on the timeline
  await lc.send('tl', 'comment', { id: 'timeline_show', at: 12.5, track: 'trk_g', text: 'Title came in late' });
  const cm = (await app.store.get('timeline_show')).data.comments;
  assert.deepEqual([cm.length, cm[0].at, cm[0].text, cm[0].name], [1, 12.5, 'Title came in late', 'Test Admin']);
  await until(() => last(crew, (x) => x.doc && (x.doc.comments || []).length === 1), 2000, 'crew sees the comment');
  await lc.send('tl', 'resolve', { id: 'timeline_show', cid: cm[0].id });
  assert.equal((await app.store.get('timeline_show')).data.comments[0].done, true);
  // saving the timeline keeps the comments
  await lc.send('tl', 'save', { id: 'timeline_show', data: saved });
  assert.equal((await app.store.get('timeline_show')).data.comments.length, 1);
  // a rundown becomes sections and a Rundown track
  const fx = (await app.store.get('fixture_one')).data;
  await put('fixture', 'fixture_one', Object.assign({}, fx, { rundown: [{ content: 'Opening', duration: '00:01:00' }, { content: 'Kick-off', duration: '00:40:00', source: 'CAMS' }, { content: 'Half time', duration: '00:10:00' }] }));
  await lc.send('tl', 'importRundown', { id: 'timeline_show', from: 'fixture_one' });
  const im = (await app.store.get('timeline_show')).data;
  assert.deepEqual(im.sections.map((s) => [s.at, s.label]), [[0, 'Opening'], [60, 'Kick-off'], [2460, 'Half time']]);
  assert.deepEqual(im.cues.filter((x) => x.track === 'trk_rundown').map((x) => [x.at, x.dur, x.label]), [[0, 60, 'Opening'], [60, 2400, 'Kick-off'], [2460, 600, 'Half time']]);
  assert.equal(im.length, 3060);
  assert.equal(im.cues.filter((x) => x.track === 'trk_g').length, 2);
  // live values are listed for templates
  const v = (await c.get('/live/api/variables')).data.vars;
  assert.ok(v.some((x) => x.key === 'timeline_next_in' && x.group === 'Timeline'));
  assert.equal(team.length > 0, true);
});
