/* The booking form on the website (/book), as data, so a site admin can change everything (Settings → Website →
   Booking form): the standard fields (show, required, label), the kinds of event, and sections of questions that show
   for certain services or kinds of event.
     core:   { <field>: { on, req, label, opts? } }   name is always on and required; email or phone is needed
     kinds:  { on, label, list: [...], skip: [service, ...] }   "What kind of event?" (not asked for the skip services)
     groups: [{ id, title, sub, when: [service or kind, ...] (empty = every service), questions: [{ id, label, type, opts, ph, req, wide }] }]
   Question types: text, long (several lines), number, date, one (pick one), many (tick any). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BookingForm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CORE = [
    ['organisation', 'Organisation / club / school / church'], ['email', 'Email'], ['phone', 'Phone (WhatsApp)'], ['contactBy', 'Best way to reach you'],
    ['date', 'Date'], ['startTime', 'Starts at'], ['endTime', 'Ends at'], ['endDate', 'Last day (if more than one day)'], ['venue', 'Venue'], ['town', 'Town / city'],
    ['budget', 'Budget (helps us quote the right package)'], ['heard', 'How did you hear about us?'], ['details', 'Tell us more']
  ];
  const TYPES = ['text', 'long', 'number', 'date', 'one', 'many'];
  const q = (label, type, opts, extra) => ({ label, type, opts: opts || [], ...(extra || {}) });
  const DEFAULT = {
    intro: 'Tell us about your event and we will get back to you with a quote. The more you fill in, the faster and more accurate it is.',
    core: {
      organisation: { on: true }, email: { on: true }, phone: { on: true }, contactBy: { on: true, opts: ['WhatsApp', 'Email', 'Phone call'] },
      date: { on: true, req: true }, startTime: { on: true }, endTime: { on: true }, endDate: { on: true }, venue: { on: true }, town: { on: true },
      budget: { on: true, opts: ['Not sure', 'Under R5 000', 'R5 000 – R10 000', 'R10 000 – R25 000', 'R25 000 – R50 000', 'Over R50 000'] },
      heard: { on: true, opts: ['Google', 'Facebook / Instagram', 'Recommended by someone', 'Saw us at an event', 'Booked before', 'Other'] },
      details: { on: true }
    },
    kinds: { on: true, label: 'What kind of event?', list: ['Church service', 'Wedding', 'Funeral / memorial', 'Concert / show', 'Conference / corporate', 'School event', 'Sport', 'Other'], skip: ['Sport broadcasts'] },
    groups: [
      { id: 'sport', title: 'The sport', sub: 'So we bring the right scoring, graphics and crew.', when: ['Sport broadcasts', 'Sport'], questions: [
        q('Sport', 'one', ['Rugby', 'Cricket', 'Soccer', 'Hockey', 'Netball', 'Athletics', 'Tennis', 'Basketball', 'Volleyball', 'Water polo', 'Swimming', 'Squash', 'Padel', 'Golf', 'Other']),
        q('Level', 'one', ['Primary school', 'High school', 'Club', 'University', 'Provincial', 'Professional', 'Tournament / festival']),
        q('Teams or age groups', 'text', [], { ph: 'e.g. 1st XV, U16A, Girls U14', wide: true }), q('Matches (who plays who)', 'text', [], { ph: 'e.g. Grey v Shimla, 15:00', wide: true }),
        q('Number of matches', 'number', [], { ph: '1' }), q('Fields or courts at the same time', 'number', [], { ph: '1' }), q('Competition or tournament', 'text', [], { ph: 'e.g. Wildeklawer, Craven Week' }),
        q('For the broadcast', 'many', ['Live score bug & match graphics', 'Commentary', 'Replays / slow motion', 'Line-ups & player stats', 'Sponsor adverts', 'Drone shots', 'Big screen at the venue', 'Match statistics for coaches', 'Highlights per match']),
        q('Sponsors to show', 'text', [], { ph: 'Names of sponsors, if any', wide: true })] },
      { id: 'church', title: 'The service', sub: '', when: ['Church service'], questions: [
        q('Kind of service', 'one', ['Sunday service', 'Special / holiday service', 'Conference', 'Youth service', 'Other']), q('How often', 'one', ['Once', 'Every week', 'Every month', 'A series']),
        q('On screen', 'many', ['Song lyrics', 'Bible verses', 'Names of speakers', 'Announcements', 'Sermon notes']), q('Afterwards', 'many', ['Sermon archive on your channel', 'Clips for social media', 'Audio only (podcast)']),
        q('Equipment you already have', 'text', [], { ph: 'Cameras, sound desk, projector…', wide: true })] },
      { id: 'family', title: 'The occasion', sub: '', when: ['Wedding', 'Funeral / memorial'], questions: [
        q('Number of guests', 'number'), q('Coverage', 'one', ['Ceremony only', 'Ceremony and reception', 'The whole day', 'Service / memorial only']),
        q('Deliverables for the family', 'many', ['Live stream for family far away', 'Private link only', 'Full ceremony film', 'Highlight film', 'Photos', 'USB / download of everything']),
        q('Names (for titles on screen)', 'text', [], { ph: 'e.g. Anna & Jan, or In memory of …', wide: true })] },
      { id: 'event', title: 'The event', sub: '', when: ['Concert / show', 'Conference / corporate', 'School event', 'Other'], questions: [
        q('Audience size', 'number'), q('Speakers or performers', 'number'), q('Sessions or rooms at the same time', 'number', [], { ph: '1' }),
        q('On the day', 'many', ['Slides / presentations on the stream', 'Remote speakers (hybrid)', 'Q&A / audience microphones', 'Names on screen (lower thirds)', 'Sponsor branding', 'Interviews', 'Several venues']),
        q('Run sheet or programme', 'text', [], { ph: 'Link, or say if you will send it', wide: true })] },
      { id: 'media', title: 'The video or photos', sub: '', when: ['Video & photography'], questions: [
        q('What you need', 'many', ['Highlights video', 'Promo / advert', 'Interviews', 'Event photos', 'Headshots / team photos', 'Social media clips', 'Drone footage']),
        q('Hours of filming / shooting', 'number'), q('Final length of the video', 'one', ['Under 1 minute', '1–3 minutes', '3–10 minutes', 'Longer', 'Not sure']),
        q('Needed by', 'date'), q('Where it will be used', 'text', [], { ph: 'Website, Instagram, TV …' })] },
      { id: 'cover', title: 'What you need', sub: 'Tick everything that applies. Not sure? Leave it and we will advise.', when: [], questions: [
        q('Deliverables', 'many', ['Live stream', 'Recording of the full event', 'Highlights video', 'Photos', 'Big screen / projection at the venue', 'Sound / PA']),
        q('Cameras', 'one', ['Not sure – advise me', '1', '2', '3', '4', '5 or more']),
        q('Stream to', 'many', ['Our website', 'YouTube', 'Facebook', 'Your own website', 'Private link only', 'Paid tickets for viewers']),
        q('Internet at the venue', 'one', ['Fibre / Wi-Fi we can use', 'Mobile signal only', 'None', 'Not sure']),
        q('Power near the cameras', 'one', ['Yes', 'No', 'Not sure']), q('Indoors or outdoors', 'one', ['Indoors', 'Outdoors', 'Both'])] }
    ]
  };

  const str = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  const list = (v, n, len) => (Array.isArray(v) ? v : String(v || '').split(/\n/)).map((x) => str(x, len || 80)).filter(Boolean).slice(0, n);
  const slug = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'q';
  // a form as sent by the editor, made safe and complete (anything missing comes from the default)
  function clean(f) {
    f = f && typeof f === 'object' ? f : {};
    const core = {};
    for (const [k] of CORE) {
      const d = DEFAULT.core[k] || {}, x = (f.core && f.core[k]) || {};
      core[k] = { on: x.on === undefined ? d.on !== false : !!x.on, req: x.req === undefined ? !!d.req : !!x.req, label: str(x.label, 80) };
      if (d.opts) core[k].opts = x.opts !== undefined ? list(x.opts, 20) : d.opts.slice();
      if (k === 'contactBy' && !core[k].opts.length) core[k].opts = d.opts.slice();
    }
    const kd = DEFAULT.kinds, kx = f.kinds || {};
    const kinds = { on: kx.on === undefined ? true : !!kx.on, label: str(kx.label, 80) || kd.label, list: kx.list !== undefined ? list(kx.list, 30) : kd.list.slice(), skip: kx.skip !== undefined ? list(kx.skip, 30) : kd.skip.slice() };
    const used = new Set();
    const groups = (Array.isArray(f.groups) ? f.groups : DEFAULT.groups).slice(0, 30).map((g) => {
      let id = slug(g.id || g.title); while (used.has(id)) id += '-2'; used.add(id);
      const qids = new Set();
      return { id, title: str(g.title, 80) || 'Questions', sub: str(g.sub, 200), when: list(g.when, 40),
        questions: (Array.isArray(g.questions) ? g.questions : []).slice(0, 40).map((x) => {
          const type = TYPES.includes(x.type) ? x.type : 'text';
          let qid = slug(x.id || x.label); while (qids.has(qid)) qid += '-2'; qids.add(qid);
          return { id: qid, label: str(x.label, 80), type, opts: type === 'one' || type === 'many' ? list(x.opts, 30) : [], ph: str(x.ph, 120), req: !!x.req, wide: !!x.wide };
        }).filter((x) => x.label) };
    });
    return { intro: f.intro !== undefined ? str(f.intro, 600) : DEFAULT.intro, core, kinds, groups };
  }
  // does this section show for the service and the kind of event chosen?
  const shown = (g, service, kind) => !!service && (!(g.when || []).length || g.when.includes(service) || (!!kind && g.when.includes(kind)));
  const asksKind = (form, service) => !!(service && form.kinds.on && form.kinds.list.length && !form.kinds.skip.includes(service));
  const labelOf = (k) => (CORE.find((c) => c[0] === k) || [k, k])[1];
  return { DEFAULT, CORE, TYPES, clean, shown, asksKind, labelOf };
});
