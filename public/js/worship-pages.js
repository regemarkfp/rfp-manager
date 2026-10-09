'use strict';
/* Worship screens in the management app: song import, CCLI usage report, Bibles on this PC. */
(function () {
  const { h, api, toast, oops } = UI;
  const head = (title, ...right) => h('div', { class: 'page-head' }, h('div', { class: 'grow' }, typeof title === 'string' ? h('h1', {}, title) : title), ...right);

  // ---- song files from SongSelect (.txt, .usr) and ChordPro ------------------------------------
  App.importSongs = () => {
    const inp = h('input', { type: 'file', multiple: true, accept: '.txt,.usr,.cho,.chopro,.chordpro,.crd,.pro,text/plain', style: { display: 'none' } });
    inp.onchange = async () => {
      let added = 0, updated = 0, failed = 0;
      for (const file of inp.files) {
        try {
          const song = Worship.parseSongFile(file.name, await file.text());
          if (!song.lyrics) { failed++; continue; }
          // The same CCLI song number (or the same title when there is none) updates the song you already have.
          const cur = App.list('song').find((d) => (song.ccliNumber && d.data.ccliNumber === song.ccliNumber) || (!song.ccliNumber && String(d.data.title).toLowerCase() === song.title.toLowerCase()));
          await App.save('song', cur ? cur.id : App.newId('song'), Object.assign({}, cur ? cur.data : {}, song));
          if (cur) updated++; else added++;
        } catch (e) { failed++; }
      }
      toast(`${added} song${added === 1 ? '' : 's'} added` + (updated ? `, ${updated} updated` : '') + (failed ? `, ${failed} could not be read` : ''));
      App.refresh();
    };
    document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  };

  // ---- CCLI usage report ------------------------------------------------------------------------
  App.pages.ccli = () => {
    const today = new Date(), iso = (d) => d.toLocaleDateString('en-CA');
    let from = iso(new Date(today.getFullYear(), today.getMonth() - 5, 1)), to = iso(today);
    const body = h('div', {});
    const rows = () => {
      const by = new Map();
      for (const d of App.list('songuse')) {
        const u = d.data;
        if (!u.date || u.date < from || u.date > to) continue;
        const k = u.ccliNumber || 'title:' + String(u.title).toLowerCase();
        const r = by.get(k) || { title: u.title, author: u.author, ccliNumber: u.ccliNumber, copyright: u.copyright, projected: 0, streamed: 0, last: '' };
        r.projected += u.projected ? 1 : 0; r.streamed += u.streamed ? 1 : 0; if (u.date > r.last) r.last = u.date;
        by.set(k, r);
      }
      return [...by.values()].sort((a, b) => b.projected - a.projected || String(a.title).localeCompare(String(b.title)));
    };
    const csv = (list) => '﻿' + [['Song title', 'CCLI song number', 'Writers', 'Copyright', 'Times projected (digital)', 'Times streamed', 'Last used'], ...list.map((r) => [r.title, r.ccliNumber, r.author, r.copyright, r.projected, r.streamed, r.last])]
      .map((r) => r.map((x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const paint = () => {
      const list = rows(), w = App.org().worship || {};
      body.replaceChildren(
        h('div', { class: 'card' }, h('div', { class: 'row' },
          h('label', { class: 'f' }, h('span', {}, 'From'), h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; paint(); } })),
          h('label', { class: 'f' }, h('span', {}, 'To'), h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; paint(); } })),
          h('div', { class: 'grow' }),
          h('div', { class: 'dim small' }, 'CCLI licence ', h('b', {}, w.ccliLicence || 'not set'), w.ccliStreamLicence ? [' · streaming ', h('b', {}, w.ccliStreamLicence)] : null),
          h('button', { class: 'primary', disabled: !list.length, onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([csv(list)], { type: 'text/csv' })), download: `ccli-song-usage-${from}-to-${to}.csv` }); a.click(); } }, 'Download CSV')),
          h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Each song counts once per service day it was put on screen from Worship control. Use these figures when you report in your CCLI account. Songs with no CCLI number are listed so you can fix them.')),
        list.length ? h('div', { class: 'tablewrap', style: { marginTop: '16px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Song', 'CCLI no.', 'Writers', 'Projected', 'Streamed', 'Last used'].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'r' : '' }, x)))),
          h('tbody', {}, list.map((r) => h('tr', {}, h('td', {}, h('b', {}, r.title)), h('td', {}, r.ccliNumber || h('span', { class: 'pill warn' }, 'missing')), h('td', { class: 'dim' }, r.author || ''), h('td', { class: 'r num' }, r.projected), h('td', { class: 'r num' }, r.streamed || ''), h('td', { class: 'dim' }, UI.fmtDate(r.last)))))))
          : h('div', { class: 'card empty', style: { marginTop: '16px' } }, 'No songs were shown in this period.'));
    };
    paint();
    return { el: h('div', {}, head('CCLI song usage'), body), keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc' && m.doc.type === 'songuse') paint(); }, 300) };
  };

  // ---- Bibles (files on this PC) ------------------------------------------------------------------
  App.pages.bibles = () => {
    const body = h('div', {});
    const local = !!App.machine.outputKey || !!App.gfx;
    const load = async () => {
      if (!local) { body.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Bibles are kept on the production PC'), h('p', { class: 'dim', style: { marginBottom: 0 } }, 'Open RFP Manager on the PC that runs Worship control and add them there.'))); return; }
      let r;
      try { r = await api('GET', '/worship/api/bibles'); } catch (e) { return oops(e); }
      const nameIn = h('input', { type: 'text', placeholder: 'Name shown in the list, e.g. Afrikaans 2020' });
      const fileIn = h('input', { type: 'file', multiple: true, accept: '.xml,.osis,.usfm,.sfm,.json,.txt', style: { display: 'none' } });
      fileIn.onchange = async () => {
        const name = nameIn.value.trim();
        if (!name) { toast('Give the Bible a name first', 'error'); fileIn.value = ''; return; }
        let books = 0, bad = 0;
        for (const f of fileIn.files) {
          try { const x = await fetch('/worship/api/bibles/import?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'x-rfp': '1', 'content-type': 'application/octet-stream' }, body: await f.arrayBuffer() }); const j = await x.json(); if (!x.ok) throw new Error(j.error); books = j.books; } catch (e) { bad++; toast(`${f.name}: ${e.message}`, 'error'); }
        }
        if (books) toast(`${name}: ${books} books on this PC`);
        load();
      };
      body.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'On this PC'),
          r.bibles.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.bibles.map((b) => h('tr', {}, h('td', {}, h('b', {}, b.name)), h('td', { class: 'dim' }, `${b.books} books · ${b.verses.toLocaleString()} verses`), h('td', { class: 'dim small' }, b.source || ''),
            h('td', { class: 'right' }, App.can('edit') ? h('button', { class: 'sm danger', onclick: async () => { if (!(await UI.confirmBox('Remove ' + b.name + ' from this PC?'))) return; try { await api('DELETE', '/worship/api/bibles/' + encodeURIComponent(b.id)); load(); } catch (e) { oops(e); } } }, 'Remove') : null))))))
            : h('p', { class: 'dim' }, 'No Bible yet.'),
          h('div', { class: 'dim small', style: { marginTop: '8px' } }, 'Files are kept in ', h('code', {}, r.folder))),
        h('div', { class: 'card' }, h('h2', {}, 'King James Version'),
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Public domain. Downloads once from the internet and is then kept on this PC.'),
          h('button', { class: 'primary', disabled: !App.can('edit'), onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Downloading…'; try { const x = await api('POST', '/worship/api/bibles/kjv'); toast(`King James Version added (${x.verses.toLocaleString()} verses)`); } catch (err) { oops(err); } load(); } }, r.bibles.some((b) => b.id === 'king-james-version') ? 'Download again' : 'Download KJV')),
        h('div', { class: 'card' }, h('h2', {}, 'Import a Bible you are licensed to use'),
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Afrikaans 1933/53, Afrikaans 2020, Nuwe Lewende Vertaling, NIV, ESV and most modern translations are copyrighted, so they cannot be included with RFP Manager. If your church has the text from the publisher or Bible Society as a file, import it here: OSIS XML, Zefania XML, USFM (select all the book files at once) or JSON.'),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, nameIn), h('button', { disabled: !App.can('edit'), onclick: () => fileIn.click() }, 'Choose files…'), fileIn)));
    };
    load();
    return { el: h('div', {}, head('Bibles'), body), keepScroll: true };
  };
})();
