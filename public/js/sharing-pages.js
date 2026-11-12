/* Media → File sharing: everyone invited to the team's shared folders (sharing.<website>), on one page. Per person:
 * their folders and role in each (viewer / editor), joined or not, last seen; change a role, take them out of a folder
 * or out of everything, send the invite again, add them to more folders. Tick people for the same on many at once.
 * The folders, with their production, and a link to each. Producers and Admins only (lib/sharing.js people()). */
'use strict';
(() => {
  const { h, api, toast, oops, confirmBox } = UI;
  const enc = encodeURIComponent;
  const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : s < 86400 * 60 ? Math.round(s / 86400) + ' days ago' : new Date(t).toLocaleDateString('en-GB'); };
  const ROLE = { viewer: 'Viewer', editor: 'Editor' };
  const ST = { q: '', folder: '', status: '' };

  // invite people (or the ticked ones) to one or more folders
  function inviteBox(data, { emails = '', after } = {}) {
    const em = h('textarea', { rows: 3, placeholder: 'one@example.com, two@example.com' }, emails);
    const role = h('select', {}, h('option', { value: 'viewer' }, 'Viewer: see and download'), h('option', { value: 'editor' }, 'Editor: also upload, rename, delete'));
    const note = h('textarea', { rows: 2, placeholder: 'A message in the email (optional)' });
    const picks = new Set(ST.folder ? [ST.folder] : []);
    const list = h('div', { class: 'fs-picks' }, data.folders.map((f) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: picks.has(f.id), onchange: (e) => { if (e.target.checked) picks.add(f.id); else picks.delete(f.id); } }),
      h('span', {}, h('b', {}, f.name), f.productionName && f.productionName !== f.name ? h('span', { class: 'dim small' }, ' · ' + f.productionName) : null))));
    UI.modal({ title: 'Invite to shared folders', wide: true, body: h('div', { class: 'form' },
      h('label', { class: 'f wide' }, h('span', {}, 'Email addresses'), em),
      h('div', { class: 'f wide' }, h('span', { class: 'flabel' }, 'Folders'), data.folders.length ? list : h('p', { class: 'dim' }, 'No shared folders yet: open File Sharing and make one, or press Shared folder on a production.')),
      h('label', { class: 'f' }, h('span', {}, 'As'), role), h('label', { class: 'f wide' }, h('span', {}, 'Message'), note),
      data.mail ? null : h('p', { class: 'help wide' }, 'Email is not set up on this website: you get each person\'s link to send yourself.')),
    actions: [{ label: 'Cancel' }, { label: 'Invite', primary: true, onClick: async () => {
      if (!picks.size) { toast('Tick at least one folder', 'error'); return false; }
      let added = 0, mailed = 0; const links = [];
      for (const id of picks) { const r = await api('POST', `/api/share/${enc(id)}/people`, { emails: em.value, role: role.value, note: note.value }); added += r.added.length; mailed += r.mailed; if (r.mailed < r.links.length) links.push(...r.links); }
      toast(`${added} invitation${added === 1 ? '' : 's'}${mailed ? `, ${mailed} emailed` : ''}${added ? '' : ' (already invited: their role was updated)'}`);
      if (links.length) UI.modal({ title: 'Send these links yourself', body: h('div', {}, links.map((l) => h('p', { class: 'small' }, h('b', {}, l.email), h('br'), h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.url)))), actions: [{ label: 'Close' }] });
      if (after) after();
    } }] });
  }

  App.pages.sharing = () => {
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const picked = new Set();
    let data = null;
    const load = async () => { try { data = await api('GET', '/api/share-people?team=' + App.team); paint(); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); } };
    const each = async (list, fn, label) => { let n = 0; for (const x of list) { try { await fn(x); n++; } catch (e) { oops(e); } } toast(`${label} (${n})`); picked.clear(); load(); };
    const removeFrom = (email, folders) => each(folders, (f) => api('DELETE', `/api/share/${enc(f.id)}/people/${enc(email)}`), 'Removed');
    function paint() {
      const words = ST.q.toLowerCase().split(/\s+/).filter(Boolean);
      const people = data.people.filter((p) => (!ST.folder || p.folders.some((f) => f.id === ST.folder))
        && (!ST.status || (ST.status === 'joined' ? p.accepted : !p.accepted))
        && words.every((w) => (p.email + ' ' + p.name + ' ' + p.folders.map((f) => f.name).join(' ')).toLowerCase().includes(w)));
      for (const e of [...picked]) if (!data.people.some((p) => p.email === e)) picked.delete(e);
      const sel = (v, opts, on) => h('select', { class: v ? 'on' : '', onchange: (e) => on(e.target.value) }, opts.map(([k, t]) => h('option', { value: k, selected: k === v }, t)));
      const chosen = () => data.people.filter((p) => picked.has(p.email));
      const bar = picked.size ? h('div', { class: 'bulk-bar' }, h('b', {}, `${picked.size} selected`), h('button', { class: 'sm ghost', onclick: () => { picked.clear(); paint(); } }, 'Clear'), h('span', { class: 'grow' }),
        h('button', { class: 'sm', onclick: () => inviteBox(data, { emails: chosen().map((p) => p.email).join(', '), after: load }) }, 'Add to folders…'),
        sel('', [['', 'Role in their folders…'], ['viewer', 'Make Viewer'], ['editor', 'Make Editor']], (v) => v && each(chosen().flatMap((p) => p.folders.filter((f) => !ST.folder || f.id === ST.folder).map((f) => ({ p, f }))), ({ p, f }) => api('PUT', `/api/share/${enc(f.id)}/people/${enc(p.email)}`, { role: v }), 'Role changed')),
        h('button', { class: 'sm danger', onclick: async () => {
          const what = ST.folder ? `from “${(data.folders.find((f) => f.id === ST.folder) || {}).name}”` : 'from all their folders';
          if (!(await confirmBox(`Remove ${picked.size} ${picked.size === 1 ? 'person' : 'people'} ${what}? Their links stop working at once.`, 'Remove'))) return;
          await each(chosen().flatMap((p) => p.folders.filter((f) => !ST.folder || f.id === ST.folder).map((f) => ({ p, f }))), ({ p, f }) => api('DELETE', `/api/share/${enc(f.id)}/people/${enc(p.email)}`), 'Removed');
        } }, ST.folder ? 'Remove from this folder' : 'Remove from everything')) : null;
      const allOn = people.length && people.every((p) => picked.has(p.email));
      const folderChip = (p, f) => h('span', { class: 'fs-chip' + (f.accepted ? '' : ' waiting'), title: f.accepted ? 'Joined' : `Invited ${ago(f.at)} by ${f.invitedBy}, not opened yet` },
        h('a', { href: data.folders.find((x) => x.id === f.id) ? data.folders.find((x) => x.id === f.id).url : '#', target: '_blank', rel: 'noopener' }, f.name),
        h('select', { title: 'Role in this folder', onchange: async (e) => { try { await api('PUT', `/api/share/${enc(f.id)}/people/${enc(p.email)}`, { role: e.target.value }); toast('Role changed'); load(); } catch (err) { oops(err); } } },
          Object.entries(ROLE).map(([k, t]) => h('option', { value: k, selected: f.role === k }, t))),
        f.accepted ? null : h('button', { class: 'sm ghost', title: 'Send the invitation email again', onclick: async () => { try { const r = await api('POST', `/api/share/${enc(f.id)}/people/${enc(p.email)}/resend`, {}); if (r.sent) toast('Invitation sent again'); else UI.modal({ title: 'Send this link yourself', body: h('p', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.url)), actions: [{ label: 'Close' }] }); } catch (e) { oops(e); } } }, '↻'),
        h('button', { class: 'sm ghost danger', title: 'Remove from this folder', onclick: async () => { if (await confirmBox(`Remove ${p.email} from “${f.name}”?`, 'Remove')) removeFrom(p.email, [f]); } }, '✕'));
      const table = people.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, h('input', { type: 'checkbox', checked: allOn, title: 'Select all shown', onchange: (e) => { for (const p of people) { if (e.target.checked) picked.add(p.email); else picked.delete(p.email); } paint(); } })),
          h('th', {}, `Person (${people.length})`), h('th', {}, 'Folders and role'), h('th', {}, 'Last seen'), h('th', {}))),
        h('tbody', {}, people.map((p) => h('tr', { class: picked.has(p.email) ? 'picked' : '' },
          h('td', { class: 'pick' }, h('input', { type: 'checkbox', checked: picked.has(p.email), onchange: (e) => { if (e.target.checked) picked.add(p.email); else picked.delete(p.email); paint(); } })),
          h('td', {}, h('b', {}, p.name || p.email.split('@')[0]), h('div', { class: 'dim small' }, p.email), h('span', { class: 'pill ' + (p.accepted ? 'ok' : 'warn') }, p.accepted ? 'Joined' : p.account ? 'Has an account, not opened yet' : 'Invited')),
          h('td', {}, h('div', { class: 'fs-chips' }, p.folders.map((f) => folderChip(p, f)))),
          h('td', { class: 'small dim nowrap' }, p.lastSeen ? ago(p.lastSeen) : '–'),
          h('td', { class: 'nowrap r' }, h('button', { class: 'sm', title: 'Invite to more folders', onclick: () => inviteBox(data, { emails: p.email, after: load }) }, '+ Folder'), ' ',
            h('button', { class: 'sm ghost danger', title: 'Remove from every folder', onclick: async () => { if (await confirmBox(`Remove ${p.email} from all ${p.folders.length} folder${p.folders.length === 1 ? '' : 's'}? Their links stop working at once.`, 'Remove')) removeFrom(p.email, p.folders); } }, 'Remove')))))))
        : h('div', { class: 'card empty' }, data.people.length ? 'Nobody matches the search and filters.' : 'Nobody has been invited yet. Press Invite people, or open a folder in File Sharing and use People.');
      const folders = h('div', { class: 'card', style: { marginTop: '16px' } }, h('h2', {}, `Folders (${data.folders.length})`),
        data.folders.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Folder'), h('th', {}, 'Production'), h('th', { class: 'r' }, 'People'), h('th', {}, 'Last activity'), h('th', {}))),
          h('tbody', {}, data.folders.map((f) => h('tr', {}, h('td', {}, h('b', {}, f.name)), h('td', {}, f.production ? h('a', { href: '#/edit/production/' + f.production }, f.productionName || 'Production') : h('span', { class: 'dim' }, '–')),
            h('td', { class: 'r num' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ST.folder = f.id; paint(); window.scrollTo(0, 0); } }, f.members)), h('td', { class: 'small dim' }, f.lastActivity ? ago(f.lastActivity) : '–'),
            h('td', { class: 'r nowrap' }, h('button', { class: 'sm', onclick: () => { ST.folder = f.id; inviteBox(data, { after: load }); } }, 'Invite'), ' ', h('a', { class: 'btn sm', href: f.url, target: '_blank', rel: 'noopener' }, 'Open ↗')))))))
          : h('p', { class: 'dim' }, 'No shared folders yet.'));
      body.replaceChildren(
        h('div', { class: 'row list-filters' },
          h('input', { type: 'search', placeholder: 'Search people or folders…', value: ST.q, style: { flex: '1 1 240px', maxWidth: '360px' }, oninput: UI.debounce((e) => { ST.q = e.target.value; paint(); }, 150) }),
          sel(ST.folder, [['', 'All folders'], ...data.folders.map((f) => [f.id, f.name])], (v) => { ST.folder = v; paint(); }),
          sel(ST.status, [['', 'Joined or not'], ['joined', 'Joined'], ['waiting', 'Not opened yet']], (v) => { ST.status = v; paint(); }),
          ST.q || ST.folder || ST.status ? h('button', { class: 'sm ghost', onclick: () => { ST.q = ''; ST.folder = ''; ST.status = ''; paint(); } }, '✕ Clear filters') : null),
        bar, table, folders);
      const inp = body.querySelector('input[type=search]'); if (document.activeElement === document.body && ST.q) { inp.focus(); inp.setSelectionRange(ST.q.length, ST.q.length); }
    }
    load();
    const site = (App.cfg.sharingUrl || '/sharing').replace(/\/+$/, '') + '/';
    return { el: h('div', {}, pageHead('File sharing', h('button', { class: 'primary', onclick: () => data && inviteBox(data, { after: load }) }, '+ Invite people'), h('a', { class: 'btn', href: site, target: '_blank', rel: 'noopener' }, 'Open File Sharing ↗')),
      h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Everyone invited to your shared folders. Viewers see and download; editors also upload, rename and delete. Producers and Admins of the team always have access.'), body),
      keepScroll: true };
  };
})();
