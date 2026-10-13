/* RFP Manager – data model. One definition drives the forms, lists, permissions and the XML save file.
   Field types: text, textarea, number, money, color, date, time, duration, select, combo, multi, bool,
   ref (another record), image, list (rows with their own fields). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFPSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = ['Admin', 'Producer', 'Scorer', 'Crew', 'Coach', 'Official'];
  // Coaches and officials see only what is about their teams and matches.
  const ROLE_SEES = {
    Coach: ['org', 'member', 'club', 'squad', 'player', 'competition', 'venue', 'fixture', 'image', 'theme'],
    Official: ['org', 'member', 'club', 'squad', 'player', 'competition', 'venue', 'fixture', 'image', 'theme'],
  };
  const EXPENSE_CATS = ['Travel', 'Fuel', 'Accommodation', 'Meals', 'Equipment hire', 'Consumables', 'Parking & tolls', 'Crew', 'Other'];
  const EXPENSE_STATUS = ['Submitted', 'Approved', 'Rejected', 'Paid back'];
  const PRODUCTION_TYPES = ['Sport', 'Corporate', 'Religion', 'Concert', 'Conference', 'Wedding', 'Awards', 'Esports', 'Other'];
  const STATUSES = ['Upcoming', 'Live', 'Completed', 'Postponed', 'Cancelled'];
  const SOURCES = ['CAMS', 'EVS', 'VT', 'GFX', 'PRESENTATION', 'REMOTE', 'BREAK'];
  const EQUIP_CATS = ['Video', 'Audio', 'Grip', 'Lighting', 'Comms', 'Other'];

  // Line colours for the rundown, as on a printed run order (yellow = live play, red = off air…).
  const LINE_COLORS = [['', 'None'], ['#ffff00', 'Yellow'], ['#ff0000', 'Red'], ['#92d050', 'Green'], ['#9bc2e6', 'Blue'], ['#ffc000', 'Orange'], ['#d9d9d9', 'Grey'], ['#e4b6ff', 'Purple']];
  const RUNDOWN = { k: 'rundown', l: 'Rundown', t: 'list', hidden: true, fields: [
    { k: 'content', l: 'Content', t: 'text' }, { k: 'description', l: 'Detail (second line)', t: 'text' },
    { k: 'startTime', l: 'Time', t: 'text', ph: 'auto', w: 100 }, { k: 'duration', l: 'Duration', t: 'duration', w: 100 },
    { k: 'source', l: 'Source', t: 'combo', opts: SOURCES, w: 130 }, { k: 'audio', l: 'Sound', t: 'text', w: 130 }, { k: 'graphics', l: 'Graphics', t: 'textarea' },
    { k: 'color', l: 'Line colour', t: 'linecolor', w: 120 }] };

  const E = {
    theme: { label: 'Theme', plural: 'Themes', group: 'Assets', title: (d) => d.name, cols: ['name', 'sports', 'templateFolder'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'description', l: 'Description', t: 'textarea' },
      { k: 'sports', l: 'Sports', t: 'multi', opts: 'sports' },
      { k: 'templateFolder', l: 'CasparCG template folder', t: 'text', ph: 'rfp', help: 'Folder inside CasparCG\'s template path that holds this theme\'s templates (bug, lowerthird, fullframe, advert).' }] },

    competition: { label: 'Competition', plural: 'Competitions', group: 'Assets', title: (d) => [d.name, d.season].filter(Boolean).join(' '), cols: ['logo', 'name', 'sport', 'season', 'theme'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports' }, { k: 'format', l: 'Format / rules', t: 'combo', opts: 'formats', ph: 'Sport default', help: 'Used by every match in this competition unless the match sets its own.' }, { k: 'season', l: 'Season', t: 'text' },
      { k: 'primaryColor', l: 'Primary colour', t: 'color' }, { k: 'secondaryColor', l: 'Secondary colour', t: 'color' },
      { k: 'logo', l: 'Logo', t: 'image' }, { k: 'theme', l: 'Theme', t: 'ref', ref: 'theme' },
      { k: 'pointsWin', l: 'Log points: win', t: 'number', ph: '3' }, { k: 'pointsDraw', l: 'Log points: draw', t: 'number', ph: '1' }, { k: 'pointsLoss', l: 'Log points: loss', t: 'number', ph: '0' }] },

    player: { label: 'Player', plural: 'Players', group: 'Assets', title: (d) => [d.name, d.surname].filter(Boolean).join(' '), cols: ['image', 'name', 'surname', 'sports', 'nationality'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'surname', l: 'Surname', t: 'text' }, { k: 'sports', l: 'Sports', t: 'multi', opts: 'sports' },
      { k: 'dateOfBirth', l: 'Date of birth', t: 'date', help: 'Age is worked out from this.' }, { k: 'height', l: 'Height (cm)', t: 'number' }, { k: 'weight', l: 'Weight (kg)', t: 'number' },
      { k: 'nationality', l: 'Nationality', t: 'text' }, { k: 'position', l: 'Position', t: 'text' }, { k: 'image', l: 'Photo', t: 'image' }] },

    venue: { label: 'Venue', plural: 'Venues', group: 'Assets', title: (d) => d.name, cols: ['name', 'city', 'country', 'sports', 'capacity'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'city', l: 'City', t: 'text' }, { k: 'country', l: 'Country', t: 'text' },
      { k: 'sports', l: 'Used for', t: 'multi', opts: 'sports' }, { k: 'capacity', l: 'Capacity', t: 'number' },
      { k: 'turf', l: 'Surface', t: 'combo', opts: ['Natural Grass', 'Artificial Turf', 'Hard Court', 'Clay', 'Indoor', 'Stage', 'Auditorium'] }, { k: 'image', l: 'Image', t: 'image' }] },

    club: { label: 'Club', plural: 'Clubs', group: 'Assets', title: (d) => d.name, cols: ['image', 'name', 'graphicName', 'abbreviation', 'primaryColor'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'graphicName', l: 'Graphic name', t: 'text', help: 'Short name shown on graphics.' },
      { k: 'abbreviation', l: 'Abbreviation', t: 'text', ph: 'CHE' }, { k: 'primaryColor', l: 'Primary colour', t: 'color' }, { k: 'secondaryColor', l: 'Secondary colour', t: 'color' },
      { k: 'image', l: 'Logo', t: 'image' }] },

    squad: { label: 'Team', plural: 'Teams', group: 'Assets',
      title: (d, get) => { const c = d.club && get ? get(d.club) : null; return [d.name || (c && c.name), d.ageGroup].filter(Boolean).join(' ') + (d.sport ? ' · ' + d.sport : ''); },
      cols: ['club', 'sport', 'ageGroup', 'name'], fields: [
      { k: 'club', l: 'Club', t: 'ref', ref: 'club', req: true }, { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports', req: true }, { k: 'ageGroup', l: 'Age group / side', t: 'text', ph: '1st XV, U19A …' },
      { k: 'name', l: 'Team name', t: 'text', inherit: 'name' }, { k: 'graphicName', l: 'Graphic name', t: 'text', inherit: 'graphicName' },
      { k: 'abbreviation', l: 'Abbreviation', t: 'text', inherit: 'abbreviation' }, { k: 'primaryColor', l: 'Primary colour', t: 'color', inherit: 'primaryColor' },
      { k: 'secondaryColor', l: 'Secondary colour', t: 'color', inherit: 'secondaryColor' }, { k: 'image', l: 'Logo', t: 'image', inherit: 'image' },
      { k: 'coach', l: 'Coach', t: 'text' },
      { k: 'players', l: 'Players', t: 'list', fields: [{ k: 'number', l: 'No.', t: 'text', w: 70 }, { k: 'player', l: 'Player', t: 'ref', ref: 'player' }, { k: 'position', l: 'Position', t: 'text' }, { k: 'captain', l: 'Capt.', t: 'bool', w: 60 }] }] },

    fixture: { label: 'Match', plural: 'Fixtures & Results', group: 'Matches', title: (d) => d.name || d.autoName || 'Match', cols: ['startDate', 'startTime', 'name', 'sport', 'status'], fields: [
      { k: 'name', l: 'Match name', t: 'text', ph: 'Generated from the teams unless you type one' }, { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports', req: true, help: 'Decides the scorer and rules: Cricket, Rugby, Rugby Sevens, Football, Hockey, Netball, Tennis, Padel, Basketball, Volleyball, Badminton, Baseball, Athletics.' },
      { k: 'competition', l: 'Competition', t: 'ref', ref: 'competition' },
      { k: 'format', l: 'Format / rules', t: 'combo', opts: 'formats', ph: 'From the competition, else the sport default', help: 'The scorer opens with these rules, so nothing has to be set up at the match. Type the sport to filter the list.' },
      { k: 'team1', l: 'Team 1', t: 'ref', ref: 'squad', sameSport: true }, { k: 'team2', l: 'Team 2', t: 'ref', ref: 'squad', sameSport: true },
      { k: 'startDate', l: 'Start date', t: 'date' }, { k: 'startTime', l: 'Start time', t: 'time' }, { k: 'endDate', l: 'End date', t: 'date' }, { k: 'endTime', l: 'End time', t: 'time' },
      { k: 'periodLength', l: 'Period length (min)', t: 'number', ph: 'sport default' }, { k: 'totalPeriods', l: 'Periods', t: 'number', ph: 'sport default' },
      { k: 'venue', l: 'Venue', t: 'ref', ref: 'venue' }, { k: 'status', l: 'Status', t: 'select', opts: STATUSES, def: 'Upcoming' },
      { k: 'commentators', l: 'Commentators', t: 'textarea', help: 'One per line. The scorer and the Commentators graphic take them from here.' },
      { k: 'officials', l: 'Match officials', t: 'textarea', help: 'One per line as Role: Name, for example Referee: A Name. The scorer and the officials graphics take them from here.' },
      { k: 'notes', l: 'Notes', t: 'textarea' }, RUNDOWN] },

    production: { label: 'Production', plural: 'Productions', group: 'Productions', title: (d) => d.name, cols: ['date', 'name', 'type', 'venue', 'client'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'type', l: 'Type', t: 'combo', opts: PRODUCTION_TYPES, def: 'Sport' },
      { k: 'date', l: 'Date', t: 'date' }, { k: 'days', l: 'Days', t: 'number', ph: '1' }, { k: 'venue', l: 'Venue', t: 'ref', ref: 'venue' },
      { k: 'event', l: 'Event', t: 'text', ph: 'From the competition unless you type one', help: 'Shown on the call sheet and rundown.' },
      { k: 'txTime', l: 'TX / kick-off time', t: 'time', help: 'Default TX time for the crew and the start line of the rundown.' },
      { k: 'client', l: 'Client', t: 'text' }, { k: 'description', l: 'Description', t: 'textarea' },
      { k: 'remoteStudio', l: 'Remote studio / gallery', t: 'text', ph: 'OB van, studio name…' }, { k: 'remoteStudioAddress', l: 'Remote studio address', t: 'text' },
      { k: 'contacts', l: 'Key contacts', t: 'list', help: 'Stadium manager, production coordinator, technical manager… Pick a crew member or type a name and number.', fields: [
        { k: 'title', l: 'Title', t: 'combo', opts: ['Stadium Manager', 'Production Coordinator', 'Technical Manager', 'Producer', 'Client Contact', 'Safety Officer'] },
        { k: 'crewMember', l: 'Crew member', t: 'ref', ref: 'crewMember' }, { k: 'name', l: 'or name', t: 'text' }, { k: 'phone', l: 'Phone', t: 'text' }] },
      { k: 'crew', l: 'Crew', t: 'list', fields: [{ k: 'location', l: 'Location', t: 'combo', opts: ['Gallery', 'Venue', 'Studio', 'OB Van', 'Remote'], w: 150 }, { k: 'role', l: 'Role', t: 'ref', ref: 'crewRole' },
        { k: 'crewMember', l: 'Crew member', t: 'ref', ref: 'crewMember' }, { k: 'callTime', l: 'Call time', t: 'time' }, { k: 'productionTime', l: 'TX time', t: 'time' },
        { k: 'rate', l: 'Day rate', t: 'money', w: 110, ph: 'role rate', help: 'Only if this person is paid differently from the role.' }, { k: 'paid', l: 'Paid', t: 'bool', w: 70 }] },
      { k: 'crewNotes', l: 'Additional information', t: 'textarea', ph: 'Entrance: please use the bottom gate. Bring a set of headphones for comms.', help: 'One point per line. Start a line with "Label:" to print the label in bold.' },
      { k: 'hospitals', l: 'Emergency: nearest hospitals', t: 'list', fields: [{ k: 'name', l: 'Hospital', t: 'text' }, { k: 'area', l: 'Area', t: 'text' }, { k: 'phone', l: 'Phone', t: 'text' }] },
      { k: 'equipment', l: 'Equipment', t: 'list', fields: [{ k: 'item', l: 'Item', t: 'ref', ref: 'equipment' }, { k: 'quantity', l: 'Qty', t: 'number', w: 80 }, { k: 'notes', l: 'Notes', t: 'text' }] },
      { k: 'extras', l: 'Other costs', t: 'list', fields: [{ k: 'description', l: 'Description', t: 'text' }, { k: 'cost', l: 'Cost', t: 'money' }, { k: 'invoice', l: 'Invoice', t: 'money' }] },
      { k: 'fixtures', l: 'Matches', t: 'list', hidden: true, fields: [{ k: 'fixture', l: 'Match', t: 'ref', ref: 'fixture' }] },
      { k: 'streamChannel', l: 'Live stream on channel', t: 'ref', ref: 'channel', group: 'Live stream', help: 'Stream this production on a channel. The stream key is made for this production (shown below once saved).' },
      { k: 'streamTitle', l: 'Stream title', t: 'text', ph: 'The production name', group: 'Live stream' },
      { k: 'streamSlug', l: 'Stream web address', t: 'text', ph: 'Made from the name and date', group: 'Live stream', help: 'Viewers watch at /watch/<this>.' },
      { k: 'streamPoster', l: 'Stream picture', t: 'image', group: 'Live stream', help: 'Shown before it starts and on the video afterwards. The channel\'s banner if empty.' },
      { k: 'streamRecord', l: 'Record the stream', t: 'bool', def: true, group: 'Live stream' },
      { k: 'streamVod', l: 'Show the recording on the website afterwards', t: 'bool', def: true, group: 'Live stream' },
      RUNDOWN] },

    graphic: { label: 'Template graphic', plural: 'Template graphics', group: 'Live', title: (d) => d.name, cols: ['name', 'template', 'kind', 'layer'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'template', l: 'Template', t: 'text', req: true, help: 'Path inside the template folder, without .html' },
      { k: 'kind', l: 'Kind', t: 'select', opts: ['lt', 'fs', 'bug', 'wipe'], def: 'lt' }, { k: 'channel', l: 'Channel (0 = program)', t: 'number' }, { k: 'layer', l: 'Layer', t: 'number', def: 35 },
      { k: 'autoClear', l: 'Take off after (seconds)', t: 'number' }, { k: 'format', l: 'Data format', t: 'select', opts: ['', 'json', 'xml'] }, { k: 'description', l: 'Notes', t: 'text' },
      { k: 'fields', l: 'Fields', t: 'list', hidden: true, fields: [{ k: 'key', l: 'Key', t: 'text' }, { k: 'label', l: 'Label', t: 'text' }, { k: 'type', l: 'Type', t: 'text' }, { k: 'value', l: 'Value', t: 'text' }] }] },

    song: { label: 'Song', plural: 'Songs', group: 'Worship', title: (d) => d.title, cols: ['title', 'author', 'ccliNumber', 'key'], fields: [
      { k: 'title', l: 'Title', t: 'text', req: true }, { k: 'author', l: 'Writers', t: 'text' },
      { k: 'copyright', l: 'Copyright', t: 'text', ph: '2012 Publisher Name (Admin. by …)', help: 'Shown with the CCLI licence number on the first and last slide.' },
      { k: 'ccliNumber', l: 'CCLI song number', t: 'text', help: 'Needed for the CCLI usage report.' }, { k: 'key', l: 'Key', t: 'text', w: 90 }, { k: 'themes', l: 'Themes', t: 'text' },
      { k: 'lyrics', l: 'Lyrics', t: 'textarea', wide: true, rows: 18, ph: '[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…', help: 'Put the section name in [brackets] on its own line. A blank line starts a new slide. Long sections are split to the number of lines per slide set in Worship settings.' },
      { k: 'notes', l: 'Notes', t: 'textarea' }] },

    service: { label: 'Service', plural: 'Services', group: 'Worship', title: (d) => d.name, cols: ['date', 'name', 'time'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true, ph: 'Sunday morning' }, { k: 'date', l: 'Date', t: 'date' }, { k: 'time', l: 'Time', t: 'time' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
      { k: 'items', l: 'Order of service', t: 'list', hidden: true, fields: [{ k: 'kind', l: 'Kind', t: 'text' }, { k: 'title', l: 'Title', t: 'text' }] }] },

    crewMember: { label: 'Crew member', plural: 'Crew', group: 'Productions', title: (d) => [d.name, d.surname].filter(Boolean).join(' '), cols: ['image', 'name', 'surname', 'phone', 'email'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'surname', l: 'Surname', t: 'text' }, { k: 'dateOfBirth', l: 'Date of birth', t: 'date' },
      { k: 'idNumber', l: 'ID number', t: 'text', sensitive: true, help: 'Only Admins and Producers can see this.' },
      { k: 'phone', l: 'Phone', t: 'text' }, { k: 'email', l: 'Email', t: 'text' }, { k: 'image', l: 'Photo', t: 'image' },
      { k: 'roles', l: 'Roles', t: 'multi', opts: 'crewRoles' }, { k: 'notes', l: 'Notes', t: 'textarea' }] },

    crewRole: { label: 'Crew role', plural: 'Crew roles', group: 'Productions', title: (d) => d.name, cols: ['name', 'maxQuantity', 'rate', 'invoiceRate'], fields: [
      { k: 'name', l: 'Role', t: 'text', req: true }, { k: 'maxQuantity', l: 'Maximum per production', t: 'number' },
      { k: 'rate', l: 'Day rate (what you pay)', t: 'money' }, { k: 'invoiceRate', l: 'Invoice rate (what you charge)', t: 'money' }] },

    equipment: { label: 'Equipment', plural: 'Equipment', group: 'Productions', title: (d) => d.name, cols: ['name', 'category', 'quantity', 'rate', 'invoiceRate'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'category', l: 'Category', t: 'combo', opts: EQUIP_CATS, def: 'Video' },
      { k: 'quantity', l: 'Quantity owned', t: 'number' }, { k: 'rate', l: 'Day cost', t: 'money' }, { k: 'invoiceRate', l: 'Day invoice rate', t: 'money' },
      { k: 'serial', l: 'Serial / asset no.', t: 'text' }, { k: 'notes', l: 'Notes', t: 'textarea' }, { k: 'image', l: 'Image', t: 'image' }] },

    advert: { label: 'Advert', plural: 'Adverts', group: 'Advertising', title: (d) => [d.name, d.sponsor].filter(Boolean).join(' · '), cols: ['image', 'name', 'sponsor', 'layout', 'duration'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'sponsor', l: 'Sponsor / client', t: 'text' },
      { k: 'kind', l: 'Kind', t: 'select', opts: ['Image', 'CasparCG clip'], def: 'Image' },
      { k: 'image', l: 'Image', t: 'image' }, { k: 'clip', l: 'CasparCG clip name', t: 'text', ph: 'ADS/SPONSOR_30', help: 'A video in CasparCG\'s media folder. Used when Kind is "CasparCG clip".' },
      { k: 'layout', l: 'Layout', t: 'select', opts: ['Full screen', 'Lower banner', 'Corner bug', 'Side panel', 'Custom position'], def: 'Full screen' },
      { k: 'duration', l: 'Duration (sec)', t: 'number', ph: '10' }, { k: 'text', l: 'Tagline', t: 'text' },
      { k: 'x', l: 'Left (px)', t: 'number', ph: '0', help: 'Custom position: from the left of the 1920×1080 picture.' }, { k: 'y', l: 'Top (px)', t: 'number', ph: '0' },
      { k: 'width', l: 'Width (px)', t: 'number', ph: '1920' }, { k: 'height', l: 'Height (px)', t: 'number', ph: '1080' },
      { k: 'fit', l: 'Picture fit', t: 'select', opts: ['Fit inside', 'Fill (crop)', 'Stretch'], def: 'Fit inside' },
      { k: 'background', l: 'Background', t: 'color', help: 'Behind the picture. Empty = transparent (black for full screen and side panel).' },
      { k: 'transition', l: 'Transition', t: 'select', opts: ['Fade', 'Slide up', 'Slide from left', 'Slide from right', 'Cut'], def: 'Fade' },
      { k: 'transitionSecs', l: 'Transition (sec)', t: 'number', ph: '0.4' },
      { k: 'channel', l: 'CasparCG channel', t: 'number', ph: 'program', help: 'Empty = the program channel.' }, { k: 'layer', l: 'CasparCG layer', t: 'number', ph: '50' },
      { k: 'template', l: 'Template', t: 'text', ph: 'advert', help: 'Another HTML template from the template folder, e.g. MYTHEME/SPONSOR. It receives image, name, sponsor, text and the position values.' },
      { k: 'loop', l: 'Loop the clip', t: 'bool', help: 'CasparCG clip only: plays again until the advert ends.' }, { k: 'volume', l: 'Clip volume (%)', t: 'number', ph: '100' },
      { k: 'from', l: 'Run from', t: 'date', help: 'Playlists skip the advert before this date.' }, { k: 'until', l: 'Run until', t: 'date', help: 'Playlists skip it after this date.' },
      { k: 'maxPerDay', l: 'Most plays a day', t: 'number', ph: 'no limit', help: 'Playlists skip it once it has played this often today on this PC.' },
      { k: 'notes', l: 'Notes', t: 'textarea' }] },

    timeline: { label: 'Timeline', plural: 'Timelines', group: 'Live', title: (d) => d.name, cols: ['date', 'name', 'production', 'length'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true, ph: 'Sunday service / Awards night / Half-time show' }, { k: 'date', l: 'Date', t: 'date' },
      { k: 'production', l: 'Production', t: 'ref', ref: 'production', help: 'Its rundown can be brought into the timeline (Timeline → Import rundown).' },
      { k: 'fixture', l: 'Match', t: 'ref', ref: 'fixture' },
      { k: 'length', l: 'Length (sec)', t: 'number', ph: '600', help: 'How long the timeline is. The playhead stops at the end.' },
      { k: 'bpm', l: 'Tempo (BPM)', t: 'number', ph: '120', help: 'For the bars-and-beats grid. A section can have its own tempo.' }, { k: 'beatsPerBar', l: 'Beats per bar', t: 'number', ph: '4' },
      { k: 'notes', l: 'Notes', t: 'textarea' }] },

    dashboard: { label: 'Dashboard', plural: 'Dashboards', group: 'Live', title: (d) => d.name, cols: ['name', 'notes'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true, ph: 'Rugby desk / Sponsor board / Tablet for the floor manager' },
      { k: 'notes', l: 'Notes', t: 'textarea' }] },
    // custom values for a sport, a competition or one match ({var_attendance}, {var_man_of_the_match} …): Live → Variables & triggers
    variable: { label: 'Variable', plural: 'Variables', group: 'Live', hidden: true, title: (d) => d.name || d.key, cols: ['name', 'key', 'scope'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'key', l: 'Key', t: 'text' }, { k: 'notes', l: 'Notes', t: 'textarea' }] },
    // when something happens in a game (a try, a six, a red card …) run actions: an advert, a graphic, a macro, set a variable
    gametrigger: { label: 'Game trigger', plural: 'Game triggers', group: 'Live', hidden: true, title: (d) => d.name, cols: ['name', 'when'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'notes', l: 'Notes', t: 'textarea' }] },
    channel: { label: 'Channel', plural: 'Channels', group: 'Streaming', title: (d) => d.name, cols: ['logo', 'name', 'owner', 'access'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true, ph: 'RegemarkFP TV, Cheetahs Rugby …' },
      { k: 'slug', l: 'Web address', t: 'text', ph: 'Made from the name', help: 'The channel page is at /c/<this>. Letters, numbers and dashes.' },
      { k: 'owner', l: 'Channel of', t: 'select', opts: ['Production company', 'Club', 'Team', 'Production'], def: 'Production company', help: 'Whose channel this is. A club or team channel takes its logo and colours unless you set them here.' },
      { k: 'club', l: 'Club', t: 'ref', ref: 'club' }, { k: 'squad', l: 'Team', t: 'ref', ref: 'squad' }, { k: 'production', l: 'Production', t: 'ref', ref: 'production' },
      { k: 'logo', l: 'Logo', t: 'image' }, { k: 'banner', l: 'Banner (wide picture at the top of the channel)', t: 'image' },
      { k: 'color', l: 'Brand colour', t: 'color', solid: true },
      { k: 'description', l: 'About', t: 'textarea', help: 'Shown on the channel page.' },
      { k: 'access', l: 'Who can watch', t: 'select', opts: ['Public', 'Team members', 'Password'], def: 'Public', help: 'Public channels are on the public website. Team members: people in this production team (signed in). Password: anyone who types the password below.' },
      { k: 'viewerPassword', l: 'Viewer password', t: 'text', help: 'Only used when "Who can watch" is Password.' },
      { k: 'disabled', l: 'Switched off', t: 'bool', help: 'Hidden, and nobody can stream to it or watch it.' }] },
    expense: { label: 'Expense', plural: 'Expenses', group: 'Productions', title: (d) => [d.description, d.amount ? Number(d.amount).toFixed(2) : ''].filter(Boolean).join(' · '), cols: ['date', 'production', 'description', 'category', 'amount', 'status'], fields: [
      { k: 'production', l: 'Production', t: 'ref', ref: 'production', req: true }, { k: 'date', l: 'Date', t: 'date' },
      { k: 'description', l: 'What for', t: 'text', req: true, ph: 'Fuel to the venue' }, { k: 'category', l: 'Category', t: 'combo', opts: EXPENSE_CATS },
      { k: 'amount', l: 'Amount', t: 'money', req: true }, { k: 'vat', l: 'VAT included', t: 'money', help: 'The VAT part of the amount, if the receipt shows it.' },
      { k: 'receipt', l: 'Receipt (photo or PDF)', t: 'image', receipt: true },
      { k: 'recharge', l: 'Invoice to the client', t: 'bool', help: 'Adds it to what you invoice for the production.' },
      { k: 'paidBy', l: 'Paid by', t: 'text', help: 'Filled in with whoever adds it.' },
      { k: 'status', l: 'Status', t: 'select', opts: EXPENSE_STATUS, def: 'Submitted', help: 'Producers and Admins approve, reject or mark as paid back.' },
      { k: 'note', l: 'Note', t: 'textarea' }] },

    playlist: { label: 'Ad playlist', plural: 'Ad playlists', group: 'Advertising', title: (d) => d.name, cols: ['name', 'loop'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'loop', l: 'Loop until stopped', t: 'bool' },
      { k: 'items', l: 'Adverts', t: 'list', fields: [{ k: 'advert', l: 'Advert', t: 'ref', ref: 'advert' }, { k: 'duration', l: 'Seconds (optional)', t: 'number', w: 150 }] }] },
  };
  for (const [type, e] of Object.entries(E)) e.type = type;

  // Record types that are not edited through the generic screens.
  // A production PC is the bridge to CasparCG: it shows everything from the website but changes only what drives the
  // playout (graphics loaded from its template folder, themes, dashboards, timelines, variables and triggers).
  // Everything else is managed on the website.
  const PC_EDIT = ['graphic', 'theme', 'dashboard', 'timeline', 'variable', 'gametrigger'];

  const SYSTEM_TYPES = ['org', 'member', 'image', 'adlog', 'playlog', 'songuse', 'user', 'machinekey'];
  const ALL_TYPES = [...Object.keys(E), ...SYSTEM_TYPES];

  const has = (v) => v !== undefined && v !== null && v !== '';
  // A team inherits name, colours and logo from its club unless it sets its own.
  function resolveSquad(squad, club) {
    const s = squad || {}, c = club || {};
    const pick = (k) => (has(s[k]) ? s[k] : c[k]);
    const name = pick('name') || '';
    return { name, graphicName: (has(s.graphicName) ? s.graphicName : has(s.name) ? s.name : c.graphicName) || name, abbreviation: pick('abbreviation') || name.slice(0, 3).toUpperCase(),
      primaryColor: pick('primaryColor') || '#ffffff', secondaryColor: pick('secondaryColor') || '#262626', image: pick('image') || '',
      sport: s.sport || '', ageGroup: s.ageGroup || '', coach: s.coach || '', players: s.players || [] };
  }

  // What a team looks like on air: name, colours, logo and squad list. get(id) returns a record's data.
  function snapshotTeam(get, squadId, fallback) {
    const squad = squadId ? get(squadId) : null;
    if (!squad) return { id: '', name: fallback, full: fallback, short: String(fallback).slice(0, 3).toUpperCase(), color1: '#ffffff', color2: '#262626', logo: '', coach: '', players: [] };
    const r = resolveSquad(squad, squad.club ? get(squad.club) : null);
    const players = [];
    for (const row of r.players) {
      const p = row.player ? get(row.player) : null;
      if (p) players.push({ id: row.player, number: String(row.number || ''), name: [p.name, p.surname].filter(Boolean).join(' '), position: row.position || p.position || '', captain: !!row.captain, image: p.image || '' });
    }
    return { id: squadId, name: r.graphicName || r.name, full: [r.name, r.ageGroup].filter(Boolean).join(' '), short: r.abbreviation, color1: r.primaryColor, color2: r.secondaryColor, logo: r.image, coach: r.coach, players };
  }

  const fieldsFor = (type, org) => {
    const base = (E[type] && E[type].fields) || [];
    const custom = ((org && org.customFields) || []).filter((f) => f.entity === type && f.label)
      .map((f) => ({ k: 'x_' + String(f.label).toLowerCase().replace(/[^a-z0-9]+/g, '_'), l: f.label, t: ['text', 'number', 'date', 'textarea', 'bool', 'color', 'image'].includes(f.type) ? f.type : 'text', custom: true }));
    return [...base, ...custom];
  };

  const age = (dob, at) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return '';
    const n = at ? new Date(at) : new Date(), b = new Date(dob + 'T00:00:00');
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 130 ? a : '';
  };

  const parseDuration = (s) => {
    const p = String(s || '').trim().split(':').map(Number);
    if (!p.length || p.some(Number.isNaN)) return 0;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
  };
  const fmtDuration = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':'); };

  // Fills in rundown start times from the first row's time and each row's duration.
  // A row with its own start time is an anchor; rows without one follow on from the row before.
  const parseClock = (s) => { const p = String(s || '').trim().split(':').map(Number); return p.length < 2 || p.some(Number.isNaN) ? null : p[0] * 3600 + p[1] * 60 + (p[2] || 0); };
  function rundownTimes(rows, firstStart) {
    let t = parseClock(firstStart) || 0;
    return (rows || []).map((r) => {
      const own = parseClock(r.startTime);
      if (own !== null) t = own;
      const start = t; t += parseDuration(r.duration);
      return { ...r, start, end: t, auto: own === null, startText: fmtDuration(start), endText: fmtDuration(t) };
    });
  }

  // Production costing: what the day costs you and what you invoice.
  function costing(prod, get) {
    const days = Math.max(1, Number(prod.days) || 1), lines = [];
    const n = (v) => Number(v) || 0;
    for (const c of prod.crew || []) {
      const role = c.role && get(c.role), m = c.crewMember && get(c.crewMember);
      lines.push({ group: 'Crew', label: (role ? role.name : 'Crew') + (m ? ' – ' + [m.name, m.surname].filter(Boolean).join(' ') : ''), qty: 1, days, cost: n(role && role.rate) * days, invoice: n(role && role.invoiceRate) * days });
    }
    for (const e of prod.equipment || []) {
      const it = e.item && get(e.item), q = Math.max(1, n(e.quantity) || 1);
      lines.push({ group: 'Equipment', label: it ? it.name : 'Item', qty: q, days, cost: n(it && it.rate) * q * days, invoice: n(it && it.invoiceRate) * q * days });
    }
    for (const x of prod.extras || []) lines.push({ group: 'Other', label: x.description || 'Other', qty: 1, days: 1, cost: n(x.cost), invoice: n(x.invoice) });
    // receipts the producer approved (or already paid back): what was really spent
    for (const x of (prod.expenses || [])) if (x.status === 'Approved' || x.status === 'Paid back') lines.push({ group: 'Expenses', label: [x.description || 'Expense', x.category].filter(Boolean).join(' · '), qty: 1, days: 1, cost: n(x.amount), invoice: x.recharge ? n(x.amount) : 0, expense: x.id || '' });
    const cost = lines.reduce((s, l) => s + l.cost, 0), invoice = lines.reduce((s, l) => s + l.invoice, 0);
    return { lines, cost, invoice, profit: invoice - cost, margin: invoice ? Math.round(((invoice - cost) / invoice) * 1000) / 10 : 0 };
  }

  // Officials named on a match ("Referee: A Name", one per line): is this person one of them?
  function officiates(fixture, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return false;
    return String((fixture && fixture.officials) || '').split(/\n+/).some((l) => { const i = l.indexOf(':'); return (i >= 0 ? l.slice(i + 1) : l).trim().toLowerCase() === want; });
  }
  const sees = (role, type) => !ROLE_SEES[role] || ROLE_SEES[role].includes(type);

  const CAN = {
    admin: (role) => role === 'Admin',
    edit: (role) => role === 'Admin' || role === 'Producer',
    score: (role) => role === 'Admin' || role === 'Producer' || role === 'Scorer',
    read: (role) => ROLES.includes(role),
  };

  return { ENTITIES: E, LINE_COLORS, ROLES, STATUSES, PRODUCTION_TYPES, SOURCES, EQUIP_CATS, SYSTEM_TYPES, ALL_TYPES, PC_EDIT, ROLE_SEES, EXPENSE_CATS, EXPENSE_STATUS, officiates, sees, resolveSquad, snapshotTeam, fieldsFor, age,
    parseDuration, fmtDuration, rundownTimes, costing, CAN };
});
