/* Search (1.4.0)
 *  · Search everything: one box (menu, or Ctrl+K / "/") over every record of the production team – productions, clients,
 *    crew, matches, players, invoices, videos, songs … – grouped by kind, Enter opens the first.
 *  · Search this page: pages with a long list or table and no search of their own get a "Search this page" box that
 *    hides the rows that do not match (kept while the page repaints). */
'use strict';
(() => {
  const { h } = UI;
  const E = Schema.ENTITIES;
  const open = (type, id) => { location.hash = type === 'fixture' ? '#/edit/fixture/' + id : type === 'invoice' ? '#/doc/' + id : '#/edit/' + type + '/' + id; };
  // the words of a record: its title and its plain text fields
  const textOf = (d) => { const parts = [App.title(d.type, d.id)]; for (const v of Object.values(d.data || {})) if (typeof v === 'string' && v.length < 300) parts.push(v); else if (typeof v === 'number') parts.push(String(v)); return parts.join(' ').toLowerCase(); };
  const kinds = () => [...new Set([...App.docs.values()].map((d) => d.type))].filter((t) => (E[t] && !E[t].hidden) || t === 'invoice');
  function find(q, limit = 40) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const ok = new Set(kinds()), out = [];
    for (const d of App.docs.values()) {
      if (d.deleted || !ok.has(d.type)) continue;
      const t = textOf(d);
      if (!words.every((w) => t.includes(w))) continue;
      const title = (App.title(d.type, d.id) || (d.data && (d.data.number || d.data.name)) || '').toLowerCase();
      out.push({ d, score: (title.startsWith(words[0]) ? 3 : 0) + (title.includes(words.join(' ')) ? 2 : 0) - (d.data.archived ? 2 : 0) });
    }
    return out.sort((a, b) => b.score - a.score || (b.d.updatedAt || 0) - (a.d.updatedAt || 0)).slice(0, limit).map((x) => x.d);
  }
  const label = (t) => (t === 'invoice' ? 'Quotes & invoices' : E[t] ? E[t].plural : t);
  const sub = (d) => { const x = d.data || {}; return [x.date || x.startDate, x.email, x.phone, x.status, x.sport, x.city, x.total ? 'R ' + Number(x.total).toFixed(2) : ''].filter(Boolean).slice(0, 3).join(' · '); };
  // the box: a dropdown of results under it
  function box({ big } = {}) {
    const input = h('input', { type: 'search', class: 'gs-in', placeholder: 'Search everything…', 'aria-label': 'Search everything', autocomplete: 'off' });
    const res = h('div', { class: 'gs-res', hidden: true });
    let hits = [], at = 0;
    const paint = () => {
      const q = input.value.trim();
      hits = find(q);
      if (!q) { res.hidden = true; return; }
      res.hidden = false;
      if (!hits.length) { res.replaceChildren(h('div', { class: 'gs-none' }, `Nothing found for “${q}”.`)); return; }
      const groups = new Map();
      hits.forEach((d) => { if (!groups.has(d.type)) groups.set(d.type, []); groups.get(d.type).push(d); });
      let i = 0;
      res.replaceChildren(...[...groups].map(([t, list]) => [h('div', { class: 'gs-g' }, label(t)), list.slice(0, 8).map((d) => { const n = i++; return h('a', { class: 'gs-hit' + (n === at ? ' on' : ''), href: '#', onmousedown: (e) => { e.preventDefault(); go(d); } },
        h('b', {}, App.title(d.type, d.id) || d.data.number || d.data.name || '(no name)'), sub(d) ? h('span', {}, sub(d)) : null); })]).flat());
    };
    const go = (d) => { input.value = ''; res.hidden = true; input.blur(); open(d.type, d.id); };
    input.addEventListener('input', () => { at = 0; paint(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, Math.max(0, res.querySelectorAll('.gs-hit').length - 1)); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); const a = res.querySelectorAll('.gs-hit')[at]; if (a) a.dispatchEvent(new MouseEvent('mousedown')); }
      else if (e.key === 'Escape') { input.value = ''; res.hidden = true; input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 150));
    input.addEventListener('focus', () => { if (input.value.trim()) paint(); });
    return h('div', { class: 'gs' + (big ? ' big' : '') }, input, res);
  }
  // Ctrl+K or "/" anywhere: focus the box in the menu (or open a search window on a phone)
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      const i = document.querySelector('.side .gs-in');
      if (i && i.offsetParent) { e.preventDefault(); i.focus(); i.select(); } else if (!typing || e.ctrlKey || e.metaKey) { e.preventDefault(); App.searchWindow(); }
    }
  });
  App.searchBox = box;
  App.searchWindow = () => { const b = box({ big: true }); UI.modal({ title: 'Search everything', body: b, actions: [{ label: 'Close' }] }); setTimeout(() => b.querySelector('input').focus(), 50); };
  App.findRecords = find;

  // ---- Search this page: for pages with many rows and no search of their own
  const ROWS = 'table.t tbody tr, .cards > .tile, .gallery > .g, .fx, .cms-row, .list-row';
  let pageQ = '', obs = null;
  const apply = (root) => {
    const words = pageQ.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0, all = 0;
    root.querySelectorAll(ROWS).forEach((r) => { if (r.closest('.modal')) return; all++; const ok = !words.length || words.every((w) => r.textContent.toLowerCase().includes(w)); r.style.display = ok ? '' : 'none'; if (ok) shown++; });
    const n = root.querySelector('.pf-count'); if (n) n.textContent = words.length ? `${shown} of ${all}` : '';
  };
  App.pageFinder = (pageEl) => {
    if (obs) { obs.disconnect(); obs = null; }
    pageQ = '';
    if (!pageEl || pageEl.querySelector('input[type=search]')) return;              // the page has its own search
    const rows = pageEl.querySelectorAll(ROWS).length;
    const add = () => {
      if (pageEl.querySelector('.pf')) return;
      const head = pageEl.querySelector('.page-head');
      const box = h('div', { class: 'pf' }, h('input', { type: 'search', placeholder: 'Search this page…', 'aria-label': 'Search this page', oninput: (e) => { pageQ = e.target.value; apply(pageEl); } }), h('span', { class: 'pf-count dim small' }));
      if (head) head.insertBefore(box, head.children[1] || null); else pageEl.prepend(box);
    };
    if (rows >= 8) add();
    // the page repaints its rows (live updates): keep the search applied, and add the box when the list grows
    obs = new MutationObserver(() => { if (!pageEl.querySelector('.pf') && pageEl.querySelectorAll(ROWS).length >= 8 && !pageEl.querySelector('input[type=search]')) add(); if (pageQ) apply(pageEl); });
    obs.observe(pageEl, { childList: true, subtree: true });
  };
})();
