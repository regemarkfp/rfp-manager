'use strict';
// The website's arrangement (Content → Website): a featured item at the top and the rows under it, in your order.
// The front page's layout is the site admins' (kv "site:layout"); a channel page's is on the channel ("layout").
//   { hero: { mode: 'auto' | 'pick' | 'none', item: { kind: 'vod' | 'series' | 'playlist' | 'live', id } },
//     rows: [ { type: 'builtin', key } | { type: 'playlist' | 'series', id, title } | { type: 'category', name, title } ] }
// 'auto' features whatever is live, else nothing. Built-in rows: what the page shows by itself (live, coming up,
// latest videos, series, playlists; on the front page also matches, fixtures, results and channels).
const BUILTIN = {
  live: 'Live now', liveMatches: 'Live matches', upcoming: 'Coming up', videos: 'Latest videos', series: 'Series', playlists: 'Playlists',
  fixtures: 'Fixtures', results: 'Results', channels: 'Channels',
};
const CHANNEL_ROWS = ['live', 'upcoming', 'videos', 'series', 'playlists'];

function makeCms(app) {
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const str = (x, n = 120) => String(x || '').slice(0, n);
  function clean(l) {
    if (!l || typeof l !== 'object') return null;
    const hero = l.hero && typeof l.hero === 'object' ? { mode: ['auto', 'pick', 'none'].includes(l.hero.mode) ? l.hero.mode : 'auto', item: l.hero.item && ['vod', 'series', 'playlist', 'live'].includes(l.hero.item.kind) ? { kind: l.hero.item.kind, id: str(l.hero.item.id, 80) } : null } : { mode: 'auto', item: null };
    const rows = (Array.isArray(l.rows) ? l.rows : []).slice(0, 40).map((r) => {
      if (!r || typeof r !== 'object') return null;
      if (r.type === 'builtin' && BUILTIN[r.key]) return { type: 'builtin', key: r.key, title: str(r.title) };
      if ((r.type === 'playlist' || r.type === 'series') && r.id) return { type: r.type, id: str(r.id, 80), title: str(r.title) };
      if (r.type === 'category' && r.name) return { type: 'category', name: str(r.name, 60), title: str(r.title) };
      return null;
    }).filter(Boolean);
    return { hero, rows };
  }
  const vodCard = (v) => v;           // publicList's cards already have the website's card shape
  async function liveCard(x, prod) {
    const ch = prod ? await data(prod.data.streamChannel) : null;
    return { href: '/watch/' + x.slug, slug: x.slug, title: x.title, poster: x.poster, channel: ch ? await app.streaming.branding(ch) : {}, live: x.live, date: x.date, time: x.time, price: x.price, start: '', duration: x.duration };
  }
  // a playlist's items as website cards
  async function playlistCards(pl, vod) {
    const items = await app.vod.playlistItems(pl, null);
    const byId = new Map(vod.videos.map((v) => [v.id, v]));
    const out = [];
    for (const it of items) {
      if (it.kind === 'live') out.push(await liveCard(it, await data(it.id)));
      else if (byId.has(it.id)) out.push(vodCard(byId.get(it.id)));
    }
    return out;
  }
  // turns the stored layout into what the page draws: rows with their cards (built-in rows stay a key; the page has those)
  async function resolve(layout, { channel, vod }) {
    if (!layout) return null;
    const rows = [];
    for (const r of layout.rows) {
      if (r.type === 'builtin') { if (!channel || CHANNEL_ROWS.includes(r.key)) rows.push({ ...r, title: r.title || BUILTIN[r.key] }); continue; }
      if (r.type === 'playlist') {
        const pl = await data(r.id);
        if (!pl || pl.type !== 'vodplaylist' || (pl.data.visibility || 'Public') === 'Hidden') continue;
        const cards = await playlistCards(pl, vod);
        if (cards.length) rows.push({ type: 'cards', title: r.title || pl.data.title, href: '/p/' + pl.id, cards });
        continue;
      }
      if (r.type === 'series') {
        const s = vod.series.find((x) => x.id === r.id);
        if (!s) continue;
        const cards = vod.videos.filter((v) => v.series === s.id).sort((a, b) => (Number(a.season) || 0) - (Number(b.season) || 0) || (Number(a.episode) || 0) - (Number(b.episode) || 0));
        if (cards.length) rows.push({ type: 'cards', title: r.title || s.title, href: s.href, cards });
        continue;
      }
      if (r.type === 'category') {
        const n = r.name.toLowerCase();
        const cards = [...vod.series.filter((x) => String(x.category).toLowerCase() === n), ...vod.playlists.filter((x) => String(x.category).toLowerCase() === n), ...vod.videos.filter((x) => String(x.category).toLowerCase() === n)];
        if (cards.length) rows.push({ type: 'cards', title: r.title || r.name, cards: cards.slice(0, 24) });
      }
    }
    let hero = null;
    const h = layout.hero || { mode: 'auto' };
    if (h.mode === 'pick' && h.item) {
      const it = h.item;
      if (it.kind === 'vod') hero = vod.videos.find((v) => v.id === it.id) || null;
      else if (it.kind === 'series') hero = vod.series.find((x) => x.id === it.id) || null;
      else if (it.kind === 'playlist') hero = vod.playlists.find((x) => x.id === it.id) || null;
      else if (it.kind === 'live') { const prod = await data(it.id); const ch = prod ? await data(prod.data.streamChannel) : null; const x = await app.vod.liveItem(prod, ch); hero = x && x.listed ? await liveCard(x, prod) : null; }
      if (hero) hero = { ...hero, kind: it.kind };
    }
    return { heroMode: h.mode, hero, rows };
  }
  return { clean, resolve, BUILTIN, CHANNEL_ROWS };
}

module.exports = { makeCms, BUILTIN, CHANNEL_ROWS };
