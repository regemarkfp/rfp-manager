/* RFP Manager – tech riders (1.6.0): what the production team brings and delivers, and what it needs from the venue
   or client (power, internet, positions, space, access …). Ready-made riders per kind of production; a team can save
   its own as "Tech rider templates". Each need has a category, the item, the detail asked for and whether it is a must.
   A venue keeps what it has (its technical profile), so the next rider at that venue fills in by itself. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFPRiders = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['Power', 'Internet', 'Positions', 'Space', 'Cabling', 'Access & parking', 'Sound', 'Lighting', 'Comms', 'Catering', 'Safety', 'Other'];
  const STATUS = { ok: 'Sorted', issue: 'Problem', na: 'Not needed', '': 'Waiting' };

  const need = (category, item, detail, required = true) => ({ category, item, detail, required });
  const BUILT_IN = [
    { id: 'builtin_sport', name: 'Sport OB (multi-camera)', productionType: 'Sport',
      setup: 'Multi-camera outside broadcast: cameras on the field and in the stand, a vision mixer and graphics in the gallery (on site or remote), live scoring graphics, commentary and the stream.',
      deliverables: [{ item: 'Programme feed', detail: '1080p50, with graphics, to the broadcaster / stream' }, { item: 'Live stream', detail: 'On our channel and restreamed if asked' }, { item: 'Recording', detail: 'Programme recording after the match' }],
      needs: [
        need('Power', 'Gallery / OB position', '2 × 16 A plugs on their own circuit (or 32 A), within 20 m'),
        need('Power', 'Camera positions', '1 × 16 A plug at each main camera position'),
        need('Internet', 'Wired connection for the stream', '20 Mbps up or more, Ethernet at the gallery; Wi-Fi only as backup'),
        need('Positions', 'Main camera (halfway line)', 'Raised position on the halfway line, 4 × 2 m, roofed if possible'),
        need('Positions', 'End-zone / behind-the-posts cameras', 'Two positions, one at each end', false),
        need('Positions', 'Commentary position', 'Table for 2–3 with a view of the field, power and a network cable'),
        need('Space', 'Gallery / OB van', 'Room or parking bay for the OB van next to the stand'),
        need('Cabling', 'Cable routes', 'Safe routes from the camera positions to the gallery (up to 150 m), no crossing walkways'),
        need('Access & parking', 'Arrival and set-up', 'Access 3 hours before kick-off; parking for 2 vehicles and the van'),
        need('Sound', 'PA / stadium sound', 'A line feed from the stadium PA for the crowd and announcements', false),
        need('Comms', 'Contact on the day', 'Name and phone of the stadium / match manager'),
        need('Catering', 'Crew meals and water', 'Water and a meal for the crew on long days', false),
        need('Safety', 'Medical and emergency', 'Where the medic is, and the emergency exits'),
      ] },
    { id: 'builtin_church', name: 'Church service livestream', productionType: 'Religion',
      setup: 'Two to four cameras, a vision mixer, lyrics and lower thirds, and the livestream with a recording for the sermon archive.',
      deliverables: [{ item: 'Livestream', detail: '1080p, on the church channel / YouTube' }, { item: 'Recording', detail: 'Full service and sermon on the website afterwards' }, { item: 'Lyrics & lower thirds', detail: 'From the song list and the preacher\'s slides' }],
      needs: [
        need('Power', 'Desk position', '2 × 16 A plugs at the stream desk'),
        need('Internet', 'Wired connection', '10 Mbps up or more, Ethernet at the stream desk'),
        need('Positions', 'Cameras', 'Centre aisle or back of the hall, and one side angle; seats kept clear'),
        need('Space', 'Stream desk', 'A table for the vision mixer and computers with a view of the stage'),
        need('Sound', 'Sound desk feed', 'A stereo feed from the sound desk (aux or matrix), not the room microphone'),
        need('Lighting', 'Stage lighting', 'The stage lights on at service level during rehearsal and the service', false),
        need('Comms', 'Running order and songs', 'Song list, readings and slides the day before'),
        need('Access & parking', 'Arrival', 'Access 2 hours before the service'),
      ] },
    { id: 'builtin_conference', name: 'Conference / corporate event', productionType: 'Conference',
      setup: 'Cameras on the stage, slides and lower thirds, sound from the event desk, recording and an optional livestream or hybrid link (Teams / Zoom).',
      deliverables: [{ item: 'Recording', detail: 'Each session, with slides and names' }, { item: 'Livestream / hybrid link', detail: 'If booked' }, { item: 'Screens in the room', detail: 'The programme feed to the venue screens if asked', }],
      needs: [
        need('Power', 'Control position', '2 × 16 A plugs at the control desk'),
        need('Internet', 'Wired connection', '20 Mbps up, Ethernet, open for streaming (RTMP/SRT) ports'),
        need('Positions', 'Camera risers', 'Back of the room and one side, 2 × 2 m each'),
        need('Space', 'Control desk', '2 tables at the back of the room'),
        need('Sound', 'Audio feed', 'A line feed from the house sound desk'),
        need('Cabling', 'Presentation laptops', 'HDMI from the lectern laptop, or the slides sent beforehand'),
        need('Lighting', 'Stage lighting', 'Front light on the speakers; no lights straight into the cameras'),
        need('Access & parking', 'Set-up', 'Access the evening before or 3 hours before the start'),
        need('Comms', 'Programme', 'Final programme, speaker names and slides the day before'),
      ] },
    { id: 'builtin_concert', name: 'Concert / show', productionType: 'Concert',
      setup: 'Multi-camera coverage of the show, a programme mix with the house sound, recording and livestream.',
      deliverables: [{ item: 'Programme recording', detail: 'Multi-camera edit-ready recording (ISO if asked)' }, { item: 'Livestream', detail: 'If booked' }, { item: 'IMAG to screens', detail: 'If asked' }],
      needs: [
        need('Power', 'Control position', '32 A or 2 × 16 A at the control position, clean power (not the lighting circuit)'),
        need('Internet', 'Wired connection', '20 Mbps up at the control position', false),
        need('Positions', 'Camera positions', 'Front of house riser, one each side of the stage, and on-stage positions agreed with the stage manager'),
        need('Sound', 'Audio feed', 'A stereo programme mix from the FOH desk (and a crowd/ambience pair)'),
        need('Lighting', 'Lighting for cameras', 'Enough front light on the artists; a look at the lighting plot beforehand'),
        need('Cabling', 'Cable routes', 'Safe routes from the stage to the control position'),
        need('Access & parking', 'Load-in and set-up', 'Load-in time, parking for the vehicles'),
        need('Comms', 'Stage manager', 'Name and phone of the stage manager, and the running order'),
        need('Safety', 'Safety briefing', 'Emergency exits and the venue safety officer'),
      ] },
  ];

  // the rider a production starts with: from a template (built-in or the team's), with what the venue already has
  function fromTemplate(t, venue) {
    const tech = (venue && venue.tech) || [];
    const key = (x) => (String(x.category || '') + '|' + String(x.item || '')).toLowerCase();
    const known = new Map(tech.filter((x) => x.item).map((x) => [key(x), x]));
    return {
      riderSetup: t.setup || '',
      riderDeliverables: (t.deliverables || []).map((x) => ({ item: x.item || '', detail: x.detail || '' })),
      riderNeeds: (t.needs || []).map((x) => { const v = known.get(key(x)); return { category: x.category || 'Other', item: x.item || '', detail: x.detail || '', required: x.required !== false, venueHas: v ? v.detail || '' : '' }; }),
    };
  }
  // a reply's key for one need (the venue answers per row; the key survives reordering)
  const needKey = (x) => (String(x.category || '') + '|' + String(x.item || '')).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  // how far the venue is: answered, sorted, problems
  function progress(needs, replies) {
    const list = (needs || []).filter((x) => x.item);
    const r = replies || {};
    const st = list.map((x) => (r[needKey(x)] || {}).status || '');
    return { total: list.length, answered: st.filter(Boolean).length, ok: st.filter((s) => s === 'ok' || s === 'na').length, issues: st.filter((s) => s === 'issue').length,
      mustOpen: list.filter((x, i) => x.required !== false && !st[i]).length };
  }

  return { CATEGORIES, STATUS, BUILT_IN, fromTemplate, needKey, progress };
});
