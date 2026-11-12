'use strict';
// YouTube videos and playlists in the content library: a pasted link becomes a VOD item (source "YouTube") that our
// own player plays (YouTube's player inside, our controls on top). Single videos need no key (YouTube's oEmbed gives
// the title and picture); with the team's YouTube Data API key (Content → YouTube key) a video also gets its length
// and description, and a playlist link brings in every video, as a playlist of ours that can be synced again.
// The key is kept on the server only (kv "yt:key:<team>") and never sent back to the app.
const { fail } = require('./util');

const ID = /^[\w-]{11}$/;
// → { video, list } from any YouTube link (watch, youtu.be, shorts, live, embed, playlist) or a bare id
function parse(input) {
  const s = String(input || '').trim();
  if (ID.test(s)) return { video: s, list: '' };
  if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(s)) return { video: '', list: s };
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (!['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null;
  const list = u.searchParams.get('list') || '';
  let video = '';
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
  else if (u.pathname === '/watch') video = u.searchParams.get('v') || '';
  else { const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(u.pathname); if (m) video = m[1]; }
  if (video && !ID.test(video)) video = '';
  if (!video && !list) return null;
  return { video, list: /^[\w-]{10,64}$/.test(list) ? list : '' };
}
// "PT1H2M10S" → 3730
function isoSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d || ''));
  return m ? (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0) : 0;
}
const thumbOf = (sn) => { const t = (sn && sn.thumbnails) || {}; return (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || ''; };

function makeYouTube(app) {
  const cfg = () => app.config;
  const apiBase = () => (cfg().youtubeApi || 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
  const oembedBase = () => cfg().youtubeOembed || 'https://www.youtube.com/oembed';
  const keyOf = async (team) => String((await app.store.kvGet('yt:key:' + team)) || '');
  async function setKey(team, key) {
    key = String(key || '').trim();
    if (key && !/^[\w-]{20,80}$/.test(key)) fail(400, 'That does not look like a YouTube Data API key (it starts with AIza…)');
    if (key) {
      const r = await fetch(`${apiBase()}/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r) fail(502, 'Could not reach YouTube to check the key');
      if (!r.ok) { const j = await r.json().catch(() => ({})); fail(400, 'YouTube did not accept the key: ' + ((j.error && j.error.message) || r.status)); }
    }
    await app.store.kvSet('yt:key:' + team, key);
    return { set: !!key };
  }
  async function api(team, path, params) {
    const key = await keyOf(team);
    if (!key) return null;
    const q = new URLSearchParams({ ...params, key });
    const r = await fetch(`${apiBase()}/${path}?${q}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r) fail(502, 'Could not reach YouTube');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) fail(r.status === 403 ? 403 : 502, 'YouTube: ' + ((j.error && j.error.message) || r.status));
    return j;
  }
  // details of up to 50 videos at once: { id → { title, description, poster, duration, author, live } }
  async function details(team, ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const j = await api(team, 'videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
      if (!j) break;
      for (const it of j.items || []) {
        if (it.status && it.status.embeddable === false) { out.set(it.id, { blocked: true, title: it.snippet.title }); continue; }
        out.set(it.id, { title: it.snippet.title, description: String(it.snippet.description || '').slice(0, 4000), poster: thumbOf(it.snippet), duration: isoSeconds(it.contentDetails.duration), author: it.snippet.channelTitle || '', live: it.snippet.liveBroadcastContent === 'live' });
      }
    }
    return out;
  }
  async function oembed(id) {
    const r = await fetch(`${oembedBase()}?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r) fail(502, 'Could not reach YouTube');
    if (r.status === 401 || r.status === 403) fail(400, 'That YouTube video cannot be shown on other websites (its owner switched embedding off)');
    if (!r.ok) fail(404, 'YouTube does not know that video (is it private or deleted?)');
    const j = await r.json();
    return { title: j.title || 'YouTube video', poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, author: j.author_name || '', duration: await pageLength(id), description: '' };
  }
  // the length of a video without an API key: YouTube's watch page carries "lengthSeconds"
  async function pageLength(id) {
    if (!ID.test(String(id || ''))) return 0;
    try {
      const r = await fetch(`${cfg().youtubeWatch || 'https://www.youtube.com/watch'}?v=${encodeURIComponent(id)}&hl=en`, { headers: { 'accept-language': 'en', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', cookie: 'CONSENT=YES+1' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return 0;
      const m = /"lengthSeconds"\s*:\s*"(\d+)"/.exec(await r.text());
      const n = m ? Number(m[1]) : 0;
      return n > 0 && n < 7 * 86400 ? n : 0;
    } catch { return 0; }
  }
  // YouTube items still without a length (added before this, or the page did not say): found once, in the background
  const tried = new Map();
  function fillLength(v) {
    if (!v || !v.data || v.data.source !== 'YouTube' || !v.data.youtube || Number(v.data.duration) > 0) return;
    if (tried.get(v.id) === 'busy' || Date.now() - (tried.get(v.id) || 0) < 6 * 3600e3) return;   // asked once; a failed try waits 6 hours
    tried.set(v.id, 'busy');
    if (tried.size > 5000) tried.clear();
    (async () => {
      let n = 0;
      const info = await details(v.team, [v.data.youtube]).catch(() => null);
      if (info && info.get(v.data.youtube)) n = info.get(v.data.youtube).duration || 0;
      if (!n) n = await pageLength(v.data.youtube);
      if (!n) { tried.set(v.id, Date.now()); return; }
      tried.delete(v.id);
      const cur = await app.store.get(v.id);
      if (cur && !cur.deleted && !(Number(cur.data.duration) > 0)) await app.save(cur.team, 'vodvideo', cur.id, { ...cur.data, duration: n }, '');
    })().catch(() => { tried.set(v.id, Date.now()); });
  }
  async function playlistItems(team, list) {
    if (!(await keyOf(team))) fail(400, 'Bringing in a whole YouTube playlist needs your YouTube Data API key (Content → YouTube key). Single videos work without it.');
    const meta = await api(team, 'playlists', { part: 'snippet', id: list });
    const pl = meta && meta.items && meta.items[0];
    if (!pl) fail(404, 'YouTube does not know that playlist (is it private?)');
    const ids = [];
    let page = '';
    for (let n = 0; n < 20; n++) {                       // up to 1000 videos
      const j = await api(team, 'playlistItems', { part: 'contentDetails', playlistId: list, maxResults: '50', ...(page ? { pageToken: page } : {}) });
      for (const it of j.items || []) if (it.contentDetails && ID.test(it.contentDetails.videoId)) ids.push(it.contentDetails.videoId);
      page = j.nextPageToken || '';
      if (!page) break;
    }
    return { title: pl.snippet.title, description: String(pl.snippet.description || '').slice(0, 4000), poster: thumbOf(pl.snippet), ids: [...new Set(ids)] };
  }

  // one video in: an existing item of this team with the same YouTube id is updated, not doubled
  async function upsertVideo(team, user, id, info, meta = {}) {
    const mine = (await app.store.list(team, 'vodvideo')).find((v) => !v.deleted && v.data.youtube === id);
    const base = mine ? mine.data : { visibility: meta.visibility || 'Public', channel: meta.channel, series: meta.series || '', season: meta.season || '', episode: meta.episode || '', tags: meta.tags || '', category: meta.category || '' };
    const data = { ...base, source: 'YouTube', youtube: id, ytPoster: info.poster || base.ytPoster || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: info.duration || base.duration || 0, ytAuthor: info.author || base.ytAuthor || '',
      title: mine && mine.data.title ? mine.data.title : String(info.title || 'YouTube video').slice(0, 160), description: mine && mine.data.description ? mine.data.description : info.description || '' };
    const vid = mine ? mine.id : 'vod_yt' + id.replace(/[^\w]/g, '').toLowerCase() + Date.now().toString(36).slice(-4);
    return app.save(team, 'vodvideo', vid, data, user.id);
  }
  // pasted links (one per line): videos, and playlists (every video, and a playlist of ours to match)
  async function importLinks(team, user, b = {}) {
    const ch = await app.store.get(String(b.channel || ''));
    if (!ch || ch.deleted || ch.type !== 'channel') fail(400, 'Choose the channel these are for');
    const links = String(b.links || b.url || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
    if (!links.length) fail(400, 'Paste a YouTube link');
    const parsed = links.map((l) => ({ link: l, p: parse(l) }));
    const bad = parsed.filter((x) => !x.p);
    if (bad.length) fail(400, 'Not a YouTube link: ' + bad[0].link);
    const meta = { channel: ch.id, visibility: b.visibility, series: b.series || '', season: Number(b.season) || '', tags: b.tags || '', category: b.category || '' };
    const videos = [], playlists = [], skipped = [];
    let ep = Number(b.episode) || 0;
    for (const { p } of parsed) {
      if (p.list && (b.whole !== false || !p.video)) {
        const pl = await playlistItems(team, p.list);
        const info = await details(team, pl.ids);
        const items = [];
        for (const id of pl.ids) {
          const d = info.get(id);
          if (!d || d.blocked) { skipped.push(d ? d.title : id); continue; }
          const doc = await upsertVideo(team, user, id, d, { ...meta, episode: meta.series && ep ? ep++ : '' });
          videos.push(doc); items.push({ kind: 'vod', id: doc.id });
        }
        if (b.makePlaylist !== false) {
          const mine = (await app.store.list(team, 'vodplaylist')).find((x) => !x.deleted && x.data.youtubePlaylist === p.list);
          const pid = mine ? mine.id : 'pl_yt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const data = mine ? { ...mine.data, items } : { title: pl.title, description: pl.description, ytPoster: pl.poster, channel: ch.id, visibility: meta.visibility || 'Public', youtubePlaylist: p.list, items, tags: meta.tags, category: meta.category };
          playlists.push(await app.save(team, 'vodplaylist', pid, data, user.id));
        }
        continue;
      }
      const d = (await details(team, [p.video])).get(p.video) || await oembed(p.video);
      if (d.blocked) { skipped.push(d.title); continue; }
      videos.push(await upsertVideo(team, user, p.video, d, { ...meta, episode: meta.series && ep ? ep++ : '' }));
    }
    return { videos, playlists, skipped, key: !!(await keyOf(team)) };
  }
  // a playlist that came from YouTube: the same again (new videos in, the order as on YouTube; our own extra items stay at the end)
  async function sync(team, user, playlistId) {
    const pl = await app.store.get(playlistId);
    if (!pl || pl.deleted || pl.team !== team || pl.type !== 'vodplaylist' || !pl.data.youtubePlaylist) fail(404, 'Not a playlist from YouTube');
    const r = await importLinks(team, user, { links: 'https://www.youtube.com/playlist?list=' + pl.data.youtubePlaylist, channel: pl.data.channel, visibility: 'Public', makePlaylist: false });
    const fromYt = r.videos.map((v) => ({ kind: 'vod', id: v.id }));
    const ytIds = new Set(fromYt.map((x) => x.id));
    const extra = (pl.data.items || []).filter((x) => !(x.kind === 'vod' && (ytIds.has(x.id) || String(x.id).startsWith('vod_yt'))));
    const doc = await app.save(team, 'vodplaylist', pl.id, { ...pl.data, items: [...fromYt, ...extra], syncedAt: Date.now() }, user.id);
    return { doc, added: r.videos.length, skipped: r.skipped };
  }
  return { parse, isoSeconds, pageLength, fillLength, setKey, hasKey: async (team) => !!(await keyOf(team)), importLinks, sync };
}

module.exports = { makeYouTube, parse, isoSeconds };
