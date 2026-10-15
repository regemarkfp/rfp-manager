/* Video analytics (Streaming → Analytics, and a card on the dashboard) and managing a production's recordings
 * (on the production: title, hide from viewers, download, delete). Website only; Producers and Admins. */
'use strict';
(() => {
  const n = (x) => Number(x || 0).toLocaleString('en-GB');
  const hours = (sec) => { sec = Number(sec || 0); if (sec < 60) return `${Math.round(sec)} s`; if (sec < 3600) return `${Math.round(sec / 60)} min`; const hh = sec / 3600; return `${hh < 10 ? hh.toFixed(1) : Math.round(hh)} h`; };
  const dur = (s) => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const allowed = () => App.cfg.mode === 'cloud' && App.can('edit');
  const tile = (label, value, sub) => h('div', { class: 'card', style: { margin: 0, padding: '14px 16px' } },
    h('div', { class: 'dim small', style: { textTransform: 'uppercase', letterSpacing: '.06em' } }, label),
    h('div', { style: { fontSize: '28px', fontWeight: 700, lineHeight: 1.2, marginTop: '4px' } }, value), sub ? h('div', { class: 'dim small' }, sub) : null);
  const tiles = (t) => h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '14px' } },
    tile('Viewers', n(t.viewers), 'different browsers'), tile('Watch time', hours(t.seconds)), tile('Most at once', n(t.peak), 'live'), tile('Watching now', n(t.watchingNow), 'live'));
  const keyName = (v) => (v.key === 'live' ? 'Live' : v.title || (v.key.startsWith('v:') ? 'Recording ' + when(v.key.slice(2)) : 'Match video'));

  // bars: viewers per day (watch time in the tooltip)
  function chart(days) {
    const W = 720, H = 160, pad = 22, max = Math.max(1, ...days.map((d) => d.viewers));
    const bw = (W - pad) / Math.max(1, days.length);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Viewers per day');
    svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
    const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
    add('line', { x1: pad, y1: H, x2: W, y2: H, stroke: 'currentColor', 'stroke-opacity': '.25' });
    add('text', { x: 0, y: 12, fill: 'currentColor', 'font-size': '11', opacity: '.6' }, n(max));
    days.forEach((d, i) => {
      const bh = Math.round((d.viewers / max) * (H - 20));
      const r = add('rect', { x: (pad + i * bw + 1).toFixed(1), y: H - bh, width: Math.max(1, bw - 2).toFixed(1), height: Math.max(bh, d.viewers ? 2 : 0), rx: 2, fill: 'var(--accent)' });
      const t = document.createElementNS(ns, 'title'); t.textContent = `${new Date(d.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${n(d.viewers)} viewers · ${hours(d.seconds)} watched${d.peak ? ' · ' + d.peak + ' at once' : ''}`; r.append(t);
      if ((i % Math.max(1, Math.round(days.length / 5)) === 0 && i < days.length - Math.max(2, Math.round(days.length / 10))) || i === days.length - 1) add('text', { x: (pad + i * bw).toFixed(1), y: H + 14, fill: 'currentColor', 'font-size': '10', opacity: '.6' }, new Date(d.day + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    });
    return svg;
  }

  let range = 30;
  App.pages.analytics = () => {
    if (!allowed()) return { el: h('div', {}, pageHead('Video analytics'), h('div', { class: 'card empty' }, App.cfg.mode === 'cloud' ? 'Producers and Admins see the video analytics.' : 'Video analytics are on the website.')) };
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const pick = h('select', { onchange: (e) => { range = Number(e.target.value); load(); } }, [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([v, l]) => h('option', { value: v, selected: v === range }, l)));
    const open = new Set();
    async function load() {
      let r;
      try { r = await api('GET', `/api/analytics?team=${App.team}&days=${range}`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const rows = [];
      for (const s of r.streams) {
        rows.push(h('tr', { class: 'click', onclick: () => { if (open.has(s.slug)) open.delete(s.slug); else open.add(s.slug); load(); } },
          h('td', {}, h('b', {}, s.title), h('div', { class: 'dim small' }, [s.date && UI.fmtDate(s.date), s.watchingNow ? `● ${s.watchingNow} watching now` : ''].filter(Boolean).join(' · '))),
          h('td', { class: 'r num' }, n(s.viewers)), h('td', { class: 'r num' }, hours(s.seconds)), h('td', { class: 'r num' }, s.peak ? n(s.peak) : '—'),
          h('td', { class: 'r' }, h('a', { class: 'small', href: '#/edit/production/' + s.production, onclick: (e) => e.stopPropagation() }, 'Production'))));
        if (open.has(s.slug)) for (const v of s.videos) rows.push(h('tr', { class: 'sub' }, h('td', { style: { paddingLeft: '22px' } }, '↳ ', keyName(v)), h('td', { class: 'r num' }, n(v.viewers)), h('td', { class: 'r num' }, hours(v.seconds)), h('td', { class: 'r num' }, v.peak ? n(v.peak) : ''), h('td', {}, '')));
      }
      body.replaceChildren(tiles(r.totals),
        h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Viewers per day'), chart(r.days), h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Hover a bar for that day\'s watch time. A viewer is one browser or phone; watch time counts while the video plays.')),
        h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Streams'),
          r.streams.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Stream'), h('th', { class: 'r' }, 'Viewers'), h('th', { class: 'r' }, 'Watch time'), h('th', { class: 'r' }, 'Most at once'), h('th', {}, ''))), h('tbody', {}, rows)))
            : h('p', { class: 'dim', style: { margin: 0 } }, 'Nobody has watched in this period yet. Numbers start from the first viewer on a /watch page.'),
          r.streams.length ? h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Tap a stream to see its live part, recordings and match videos.') : null));
    }
    load();
    return { el: h('div', {}, pageHead('Video analytics', pick), body), keepScroll: true };
  };

  // a small card on the dashboard
  function dashCard() {
    if (!allowed()) return null;
    const box = h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Video analytics · 30 days'), h('a', { class: 'small', href: '#/analytics' }, 'Open')), h('div', { class: 'dim small' }, 'Loading…'));
    api('GET', `/api/analytics?team=${App.team}&days=30`).then((r) => {
      if (!r.streams.length) { box.style.display = 'none'; return; }
      const top = r.streams.slice(0, 3);
      box.replaceChildren(h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Video analytics · 30 days'), h('a', { class: 'small', href: '#/analytics' }, 'Open')),
        h('div', { style: { marginTop: '10px' } }, tiles(r.totals)),
        h('div', { style: { marginBottom: '6px' } }, chart(r.days)),
        top.map((s) => h('div', { class: 'spread', style: { padding: '6px 0', borderTop: '1px solid var(--line)' } }, h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.title), h('span', { class: 'dim small nowrap' }, `${n(s.viewers)} viewers · ${hours(s.seconds)}`))));
    }).catch(() => { box.style.display = 'none'; });
    return box;
  }
  const below = App.dashBelowHero;
  App.dashBelowHero = () => [...[].concat(below ? below() : []), dashCard()];

  // ---- a production's recordings: rename, hide from viewers, download, delete
  App.recordingsCard = (doc) => {
    const box = h('div', { class: 'card' });
    const paint = async () => {
      const cur = App.docs.get(doc.id) || doc;
      if (!cur.data.streamSlug || !allowed()) { box.style.display = 'none'; return; }
      let r;
      try { r = await api('GET', `/api/productions/${encodeURIComponent(doc.id)}/recordings?team=${App.team}`); } catch (e) { box.style.display = ''; box.replaceChildren(h('h2', {}, 'Recordings'), h('p', { class: 'dim' }, e.message)); return; }
      box.style.display = '';
      const base = `/api/productions/${encodeURIComponent(doc.id)}/recordings/`;
      const save = async (v, body) => { try { await api('PUT', base + encodeURIComponent(v.start) + '?team=' + App.team, body); toast(body.hidden === undefined ? 'Saved' : body.hidden ? 'Hidden from viewers' : 'Shown to viewers'); paint(); } catch (e) { oops(e); } };
      const row = (v) => {
        const title = h('input', { value: v.title || '', placeholder: when(v.start), style: { minWidth: '160px' } });
        return h('tr', {},
          h('td', {}, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, title, h('button', { class: 'sm', onclick: () => save(v, { title: title.value }) }, 'Save')), h('div', { class: 'dim small', style: { marginTop: '3px' } }, when(v.start), ' · ', dur(v.duration), v.hidden ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'Hidden') : null)),
          h('td', { class: 'r num nowrap' }, n(v.viewers), h('div', { class: 'dim small' }, hours(v.seconds))),
          h('td', { class: 'r nowrap' },
            h('a', { class: 'btn sm', href: `${r.watch}?v=${encodeURIComponent(v.start)}`, target: '_blank', rel: 'noopener' }, 'Watch'), ' ',
            h('a', { class: 'btn sm', href: v.url, download: `${(cur.data.streamTitle || cur.data.name || 'recording').replace(/[\\/:*?"<>|]+/g, '-')} ${v.start.slice(0, 16).replace('T', ' ').replace(':', 'h')}.mp4` }, 'Download'), ' ',
            h('button', { class: 'sm', onclick: () => save(v, { hidden: !v.hidden }) }, v.hidden ? 'Show' : 'Hide'), ' ',
            h('button', { class: 'sm danger', onclick: async () => {
              if (!(await confirmBox(`Delete the recording of ${when(v.start)} (${dur(v.duration)}) for good? Its file is removed from the streaming server and viewers can no longer watch it. Download it first if you want to keep a copy.`))) return;
              try { const x = await api('DELETE', base + encodeURIComponent(v.start) + '?team=' + App.team); toast(`Recording deleted (${x.deleted} file${x.deleted === 1 ? '' : 's'})`); paint(); } catch (e) { oops(e); }
            } }, 'Delete')));
      };
      box.replaceChildren(h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, `Recordings (${r.list.length})`), h('span', { class: 'dim small' }, `Live: ${n(r.live.viewers)} viewers · ${hours(r.live.seconds)} watched${r.live.peak ? ' · ' + n(r.live.peak) + ' at once' : ''}`)),
        r.list.length ? h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Recording'), h('th', { class: 'r' }, 'Viewers'), h('th', {}, ''))), h('tbody', {}, r.list.map(row))))
          : h('p', { class: 'dim', style: { marginBottom: 0 } }, 'Nothing recorded yet. Each time you stream, the recording shows up here a minute after you stop.'),
        r.list.length ? h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Give a recording a title viewers see, hide it from the website, or delete it. Hidden recordings stay here for your team.') : null);
    };
    paint();
    box.repaint = paint;
    return box;
  };
})();
