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
  const BOOKING_STATUS = ['New', 'Assigned', 'Accepted', 'Declined by producer', 'Quoted', 'Booked', 'Not going ahead'];
  const BOOKING_STAGES = ['Received', 'Being reviewed', 'Quote sent', 'Confirmed', 'Crew booked', 'Event day', 'Completed', 'Declined', 'Cancelled'];   // what the client sees (lib/bookings.js)
  const EXPENSE_STATUS = ['Submitted', 'Approved', 'Rejected', 'Paid back'];
  const PRODUCTION_TYPES = ['Sport', 'Corporate', 'Religion', 'Concert', 'Conference', 'Wedding', 'Awards', 'Esports', 'Other'];
  const GENDERS = ['Male', 'Female', 'Mixed'];
  const AGE_GROUPS = ['Adults', 'Seniors', 'U21', 'U20', 'U19', 'U18', 'U17', 'U16', 'U15', 'U14', 'U13', 'U12', 'U11', 'U10', 'U9', 'U8', 'Veterans', 'Masters'];
  const DIVISIONS = ['First Grade', 'Second Grade', 'Third Grade', 'Reserves', '1st Team', '2nd Team', 'A', 'B', 'C', 'D', 'Premier', 'Division 1', 'Division 2'];
  const POSITION_TYPES = ['Forward', 'Back', 'Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Shooter', 'Centre', 'Guard', 'Utility'];
  const COVERAGE = ['Standard', 'Minimum'];
  const PLAYER_EVENTS = ['All', 'Scoring only', 'None'];
  // Match settings a competition gives every match (a match can set its own). Same set as LIGR's match config.
  const MATCH_SETTINGS = (g) => [
    { k: 'totalPeriods', l: 'Periods', t: 'number', ph: 'sport default', group: g },
    { k: 'periodLength', l: 'Period length (min)', t: 'number', ph: 'sport default', group: g },
    { k: 'breakLength', l: 'Break length (min)', t: 'number', ph: 'sport default', group: g, help: 'Half-time / break between periods.' },
    { k: 'overtime', l: 'Overtime / extra time', t: 'bool', group: g },
    { k: 'goldenPoint', l: 'Golden point (next score wins in overtime)', t: 'bool', group: g },
    { k: 'kickingComp', l: 'Kicking competition / shoot-out if still level', t: 'bool', group: g },
    { k: 'sinbinMin', l: 'Sin bin / suspension (min)', t: 'number', ph: 'sport default', group: g },
    { k: 'red20', l: '20-minute red card (replacement after 20 min)', t: 'bool', group: g },
    { k: 'statCoverage', l: 'Stats to capture', t: 'select', opts: COVERAGE, def: 'Standard', group: g, help: 'Minimum: scores and cards only. Standard: also the match statistics.' },
    { k: 'playerEvents', l: 'Ask for the player', t: 'select', opts: PLAYER_EVENTS, def: 'All', group: g, help: 'All: every event asks who. Scoring only: only scores and cards. None: team only (fastest).' },
    { k: 'lineupSize', l: 'Starting line-up size', t: 'number', ph: 'sport default', group: g },
    { k: 'benchSize', l: 'Max bench size', t: 'number', ph: 'sport default', group: g },
  ];
  // music rights: how a track was used (as on a SAMRO / broadcaster cue sheet) and where it may be used
  const MUSIC_USAGE = ['Theme', 'Opening titles', 'Closing titles', 'Bumper / sting', 'Background', 'Featured', 'Signature', 'Source (live at venue)'];
  const MUSIC_SOURCES = ['Commercial release (SAMRO / NORM)', 'Production music library', 'Royalty-free', 'Commissioned', 'Own composition', 'Public domain'];
  // the post-production report: what is rated (1–5 stars) when a production is completed, and how bad an issue was
  const REPORT_ASPECTS = [['overall', 'Overall'], ['vision', 'Cameras & vision'], ['audio', 'Audio'], ['graphics', 'Graphics'], ['stream', 'Stream / transmission'], ['crew', 'Crew & teamwork'],
    ['timing', 'Timing & punctuality'], ['equipment', 'Equipment'], ['client', 'Client satisfaction']];
  const ISSUE_SEVERITY = ['Minor', 'Moderate', 'Major', 'Critical'];
  const PRODUCTION_STATUS = ['Planned', 'Confirmed', 'Completed', 'Cancelled'];
  const MUSIC_MEDIA = ['TV broadcast', 'Live stream', 'Social media', 'Venue / PA', 'Radio'];
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
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'graphicName', l: 'Graphic name', t: 'text', ph: 'The name', help: 'How the name reads on graphics.' }, { k: 'shortName', l: 'Short name', t: 'text', ph: 'CCC' },
      { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports' }, { k: 'format', l: 'Format / rules', t: 'combo', opts: 'formats', ph: 'Sport default', help: 'Used by every match in this competition unless the match sets its own.' }, { k: 'season', l: 'Season', t: 'text' },
      { k: 'ageGroup', l: 'Age group', t: 'combo', opts: AGE_GROUPS }, { k: 'gender', l: 'Gender', t: 'select', opts: ['', ...GENDERS] }, { k: 'division', l: 'Division', t: 'combo', opts: DIVISIONS },
      { k: 'primaryColor', l: 'Primary colour', t: 'color' }, { k: 'secondaryColor', l: 'Secondary colour', t: 'color' },
      { k: 'logo', l: 'Logo', t: 'image' }, { k: 'watermark', l: 'Primary watermark', t: 'image' }, { k: 'watermark2', l: 'Secondary watermark', t: 'image' }, { k: 'theme', l: 'Theme', t: 'ref', ref: 'theme' },
      { k: 'teams', l: 'Teams in this competition', t: 'list', fields: [{ k: 'team', l: 'Team', t: 'ref', ref: 'squad' }] },
      ...MATCH_SETTINGS('Match settings'),
      { k: 'fieldGoalPoints', l: 'Field / drop goal points', t: 'number', ph: 'sport default', group: 'Match settings' },
      { k: 'music', l: 'Theme music', t: 'list', group: 'Theme music', help: 'Played from Graphics control → Music for every match of this competition. Admins and Producers set it.', fields: [
        { k: 'track', l: 'Track', t: 'ref', ref: 'track' }, { k: 'usage', l: 'Used as', t: 'combo', opts: MUSIC_USAGE, w: 170 }] },
      { k: 'pointsWin', l: 'Log points: win', t: 'number', ph: '3', group: 'Log' }, { k: 'pointsDraw', l: 'Log points: draw', t: 'number', ph: '1', group: 'Log' }, { k: 'pointsLoss', l: 'Log points: loss', t: 'number', ph: '0', group: 'Log' },
      { k: 'archived', l: 'Archived (greyed out in lists, left out of pickers)', t: 'bool', group: 'Archive' }] },

    player: { label: 'Player', plural: 'Players', group: 'Assets', title: (d) => [d.name, d.surname].filter(Boolean).join(' '), cols: ['image', 'name', 'surname', 'sports', 'nationality'], fields: [
      { k: 'name', l: 'First name', t: 'text', req: true }, { k: 'surname', l: 'Last name', t: 'text' },
      { k: 'graphicFirstName', l: 'Graphic first name', t: 'text', ph: 'First name', help: 'How the name reads on graphics (leave empty to use the name).' }, { k: 'graphicLastName', l: 'Graphic last name', t: 'text', ph: 'Last name' },
      { k: 'sports', l: 'Sports', t: 'multi', opts: 'sports' },
      { k: 'dateOfBirth', l: 'Date of birth', t: 'date', help: 'Age is worked out from this.' }, { k: 'height', l: 'Height (cm)', t: 'number' }, { k: 'weight', l: 'Weight (kg)', t: 'number' },
      { k: 'nationality', l: 'Nationality', t: 'text' }, { k: 'position', l: 'Position', t: 'text' }, { k: 'positionType', l: 'Position type', t: 'combo', opts: POSITION_TYPES }, { k: 'image', l: 'Photo', t: 'image' },
      { k: 'archived', l: 'Archived (greyed out in lists, left out of pickers)', t: 'bool' }] },

    venue: { label: 'Venue', plural: 'Venues', group: 'Assets', title: (d) => d.name, cols: ['name', 'city', 'country', 'sports', 'capacity'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'graphicName', l: 'Graphic name', t: 'text', ph: 'The name' }, { k: 'address', l: 'Address', t: 'text' }, { k: 'city', l: 'City', t: 'text' }, { k: 'country', l: 'Country', t: 'text' },
      { k: 'homeClub', l: 'Home ground of', t: 'ref', ref: 'club' }, { k: 'areas', l: 'Areas / fields', t: 'list', fields: [{ k: 'name', l: 'Name', t: 'text', ph: 'Field 2, Court A …' }] },
      { k: 'sports', l: 'Used for', t: 'multi', opts: 'sports' }, { k: 'capacity', l: 'Capacity', t: 'number' },
      { k: 'turf', l: 'Surface', t: 'combo', opts: ['Natural Grass', 'Artificial Turf', 'Hard Court', 'Clay', 'Indoor', 'Stage', 'Auditorium'] }, { k: 'image', l: 'Image', t: 'image' }] },

    club: { label: 'Club', plural: 'Clubs', group: 'Assets', title: (d) => d.name, cols: ['image', 'name', 'graphicName', 'abbreviation', 'primaryColor'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'fullGraphicName', l: 'Full graphic name', t: 'text', ph: 'Vodacom Blue Bulls', help: 'Long name on full-frame graphics.' },
      { k: 'graphicName', l: 'Graphic name', t: 'text', help: 'Medium name shown on most graphics.' },
      { k: 'abbreviation', l: 'Abbreviation', t: 'text', ph: 'CHE' }, { k: 'defaultVenue', l: 'Home venue', t: 'ref', ref: 'venue' },
      { k: 'primaryColor', l: 'Primary colour', t: 'color' }, { k: 'primaryTextColor', l: 'Primary text colour', t: 'color' },
      { k: 'secondaryColor', l: 'Secondary colour', t: 'color' }, { k: 'secondaryTextColor', l: 'Secondary text colour', t: 'color' },
      { k: 'image', l: 'Logo', t: 'image', help: 'A transparent background with no padding works best.' },
      { k: 'homeKit1', l: 'Home kit: primary', t: 'color', group: 'Kits' }, { k: 'homeKit2', l: 'Home kit: secondary', t: 'color', group: 'Kits' },
      { k: 'awayKit1', l: 'Away kit: primary', t: 'color', group: 'Kits' }, { k: 'awayKit2', l: 'Away kit: secondary', t: 'color', group: 'Kits' },
      { k: 'altKit1', l: 'Alternative kit: primary', t: 'color', group: 'Kits' }, { k: 'altKit2', l: 'Alternative kit: secondary', t: 'color', group: 'Kits' },
      { k: 'archived', l: 'Archived (greyed out in lists, left out of pickers)', t: 'bool', group: 'Archive' }] },

    squad: { label: 'Team', plural: 'Teams', group: 'Assets',
      title: (d, get) => { const c = d.club && get ? get(d.club) : null; return [d.name || (c && c.name), d.ageGroup].filter(Boolean).join(' ') + (d.sport ? ' · ' + d.sport : ''); },
      cols: ['club', 'sport', 'ageGroup', 'name'], fields: [
      { k: 'club', l: 'Club', t: 'ref', ref: 'club', req: true }, { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports', req: true }, { k: 'ageGroup', l: 'Age group / side', t: 'combo', opts: AGE_GROUPS, ph: '1st XV, U19A …' },
      { k: 'gender', l: 'Gender', t: 'select', opts: ['', ...GENDERS] }, { k: 'division', l: 'Division', t: 'combo', opts: DIVISIONS },
      { k: 'name', l: 'Team name', t: 'text', inherit: 'name' }, { k: 'graphicName', l: 'Graphic name', t: 'text', inherit: 'graphicName' },
      { k: 'abbreviation', l: 'Abbreviation', t: 'text', inherit: 'abbreviation' }, { k: 'primaryColor', l: 'Primary colour', t: 'color', inherit: 'primaryColor' },
      { k: 'secondaryColor', l: 'Secondary colour', t: 'color', inherit: 'secondaryColor' }, { k: 'image', l: 'Logo', t: 'image', inherit: 'image' },
      { k: 'coach', l: 'Coach', t: 'text' },
      { k: 'players', l: 'Players', t: 'list', help: 'Starter ticked = in the starting line-up by default; the scorer can change the line-up for each match.', fields: [{ k: 'number', l: 'No.', t: 'text', w: 70 }, { k: 'player', l: 'Player', t: 'ref', ref: 'player' }, { k: 'position', l: 'Position', t: 'text' },
        { k: 'positionType', l: 'Type', t: 'combo', opts: POSITION_TYPES, w: 120 }, { k: 'starter', l: 'Starter', t: 'bool', w: 70 }, { k: 'captain', l: 'Capt.', t: 'bool', w: 60 }] },
      { k: 'archived', l: 'Archived (greyed out in lists, left out of pickers)', t: 'bool' }] },

    fixture: { label: 'Match', plural: 'Fixtures & Results', group: 'Matches', title: (d) => d.name || d.autoName || 'Match', cols: ['startDate', 'startTime', 'name', 'sport', 'status'], fields: [
      { k: 'name', l: 'Match name', t: 'text', ph: 'Generated from the teams unless you type one' }, { k: 'sport', l: 'Sport', t: 'combo', opts: 'sports', req: true, help: 'Decides the scorer and rules: Cricket, Rugby, Rugby Sevens, Football, Hockey, Netball, Tennis, Padel, Basketball, Volleyball, Badminton, Baseball, Athletics.' },
      { k: 'competition', l: 'Competition', t: 'ref', ref: 'competition' },
      { k: 'format', l: 'Format / rules', t: 'combo', opts: 'formats', ph: 'From the competition, else the sport default', help: 'The scorer opens with these rules, so nothing has to be set up at the match. Type the sport to filter the list.' },
      { k: 'team1', l: 'Team 1', t: 'ref', ref: 'squad', sameSport: true }, { k: 'team2', l: 'Team 2', t: 'ref', ref: 'squad', sameSport: true },
      { k: 'startDate', l: 'Start date', t: 'date' }, { k: 'startTime', l: 'Start time', t: 'time' }, { k: 'endDate', l: 'End date', t: 'date' }, { k: 'endTime', l: 'End time', t: 'time' },
      { k: 'venue', l: 'Venue', t: 'ref', ref: 'venue', ph: 'Home team\'s venue' }, { k: 'status', l: 'Status', t: 'select', opts: STATUSES, def: 'Upcoming' },
      { k: 'scorer', l: 'Scorer', t: 'member', roles: ['Scorer', 'Producer', 'Admin'] },
      { k: 'commentators', l: 'Commentators', t: 'textarea', help: 'One per line. The scorer and the Commentators graphic take them from here.' },
      { k: 'officials', l: 'Match officials', t: 'textarea', help: 'One per line as Role: Name, for example Referee: A Name. The scorer and the officials graphics take them from here.' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
      ...MATCH_SETTINGS('Match settings (empty = from the competition)').map((f) => Object.assign({}, f, { def: undefined, opts: f.t === 'select' ? ['', ...f.opts] : f.opts, t: f.t === 'bool' ? 'select' : f.t }, f.t === 'bool' ? { opts: ['', 'Yes', 'No'] } : {})),
      RUNDOWN] },

    production: { label: 'Production', plural: 'Productions', group: 'Productions', title: (d) => (d.number ? d.number + ' · ' : '') + (d.name || ''), cols: ['number', 'date', 'name', 'type', 'status', 'venue', 'client'], fields: [
      { k: 'number', l: 'Production no.', t: 'text', readonly: true, ph: 'Given when saved', w: 130, help: 'Given by the website in order (P + year + number) and never reused, so every production can be told apart and found again.' },
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'type', l: 'Type', t: 'combo', opts: PRODUCTION_TYPES, def: 'Sport' },
      { k: 'status', l: 'Status', t: 'select', opts: PRODUCTION_STATUS, def: 'Planned', help: 'Complete a production with the "Complete production" button: it asks for the report (ratings and issues).' },
      { k: 'date', l: 'Date', t: 'date' }, { k: 'days', l: 'Days', t: 'number', ph: '1' }, { k: 'venue', l: 'Venue', t: 'ref', ref: 'venue' },
      { k: 'event', l: 'Event', t: 'text', ph: 'From the competition unless you type one', help: 'Shown on the call sheet and rundown.' },
      { k: 'txTime', l: 'TX / kick-off time', t: 'time', help: 'Default TX time for the crew and the start line of the rundown.' },
      { k: 'client', l: 'Client', t: 'text' }, { k: 'clientEmail', l: 'Client email', t: 'text', help: 'Quotes, invoices and the client page go here.' }, { k: 'producer', l: 'Producer', t: 'member', roles: ['Producer', 'Admin'] }, { k: 'description', l: 'Description', t: 'textarea' },
      { k: 'booking', l: 'Booking request', t: 'ref', ref: 'booking', hidden: true },
      { k: 'remoteStudio', l: 'Remote studio / gallery', t: 'text', ph: 'OB van, studio name…' }, { k: 'remoteStudioAddress', l: 'Remote studio address', t: 'text' },
      { k: 'contacts', l: 'Key contacts', t: 'list', help: 'Stadium manager, production coordinator, technical manager… Pick a crew member or type a name and number.', fields: [
        { k: 'title', l: 'Title', t: 'combo', opts: ['Stadium Manager', 'Production Coordinator', 'Technical Manager', 'Producer', 'Client Contact', 'Safety Officer'] },
        { k: 'crewMember', l: 'Crew member', t: 'ref', ref: 'crewMember' }, { k: 'name', l: 'or name', t: 'text' }, { k: 'phone', l: 'Phone', t: 'phone' }] },
      { k: 'crew', l: 'Crew', t: 'list', fields: [{ k: 'location', l: 'Location', t: 'combo', opts: ['Gallery', 'Venue', 'Studio', 'OB Van', 'Remote'], w: 150 }, { k: 'role', l: 'Role', t: 'ref', ref: 'crewRole' },
        { k: 'crewMember', l: 'Crew member', t: 'ref', ref: 'crewMember' }, { k: 'callTime', l: 'Call time', t: 'time' }, { k: 'productionTime', l: 'TX time', t: 'time' },
        { k: 'confirmed', l: 'Confirmed', t: 'bool', w: 90, help: 'Tick when this person has said yes: they get an email that they are hired, with the call sheet.' },
        { k: 'rate', l: 'Day rate', t: 'money', w: 110, ph: 'role rate', help: 'Only if this person is paid differently from the role.' }, { k: 'paid', l: 'Paid', t: 'bool', w: 70 }] },
      { k: 'crewNotes', l: 'Additional information', t: 'textarea', ph: 'Entrance: please use the bottom gate. Bring a set of headphones for comms.', help: 'One point per line. Start a line with "Label:" to print the label in bold.' },
      { k: 'hospitals', l: 'Emergency: nearest hospitals', t: 'list', fields: [{ k: 'name', l: 'Hospital', t: 'text' }, { k: 'area', l: 'Area', t: 'text' }, { k: 'phone', l: 'Phone', t: 'phone' }] },
      { k: 'equipment', l: 'Equipment', t: 'list', fields: [{ k: 'item', l: 'Item', t: 'ref', ref: 'equipment' }, { k: 'quantity', l: 'Qty', t: 'number', w: 80 }, { k: 'notes', l: 'Notes', t: 'text' }] },
      { k: 'extras', l: 'Other costs', t: 'list', fields: [{ k: 'description', l: 'Description', t: 'text' }, { k: 'cost', l: 'Cost', t: 'money' }, { k: 'invoice', l: 'Invoice', t: 'money' }] },
      { k: 'fixtures', l: 'Matches', t: 'list', hidden: true, fields: [{ k: 'fixture', l: 'Match', t: 'ref', ref: 'fixture' }] },
      { k: 'music', l: 'Music (theme for this production)', t: 'list', group: 'Music & report', help: 'Extra or replacement theme music for this production; the competition\'s theme music is used as well.', fields: [
        { k: 'track', l: 'Track', t: 'ref', ref: 'track' }, { k: 'usage', l: 'Used as', t: 'combo', opts: MUSIC_USAGE, w: 170 }] },
      { k: 'broadcaster', l: 'Broadcaster / channel', t: 'text', ph: 'SuperSport, YouTube …', group: 'Music & report', help: 'Printed on the music cue sheet and the report.' },
      { k: 'programmeTitle', l: 'Programme title', t: 'text', ph: 'The production name', group: 'Music & report' },
      { k: 'incidents', l: 'Issues & incidents', t: 'list', group: 'Music & report', help: 'Faults, delays and anything else for the post-production report.', fields: [
        { k: 'time', l: 'Time', t: 'time', w: 100 }, { k: 'category', l: 'Kind', t: 'combo', opts: ['Technical', 'Delay', 'Graphics', 'Audio', 'Vision', 'Stream', 'Crew', 'Equipment', 'Client', 'Weather', 'Other'], w: 130 },
        { k: 'severity', l: 'Severity', t: 'select', opts: ISSUE_SEVERITY, def: 'Minor', w: 120 }, { k: 'text', l: 'What happened', t: 'text' }, { k: 'action', l: 'What was done / to do', t: 'text' }, { k: 'resolved', l: 'Resolved', t: 'bool', w: 80 }] },
      { k: 'reportNotes', l: 'Report summary', t: 'textarea', group: 'Music & report' },
      { k: 'sermonTitle', l: 'Sermon / message title', t: 'text', group: 'Sermon (church services)', help: 'Church services: shown in the channel\'s sermon archive with the recording.' },
      { k: 'preacher', l: 'Preacher / speaker', t: 'text', group: 'Sermon (church services)' }, { k: 'scripture', l: 'Scripture', t: 'text', ph: 'John 3:16-21; Ps 23', group: 'Sermon (church services)' },
      { k: 'series', l: 'Series', t: 'text', group: 'Sermon (church services)' }, { k: 'sermonNotes', l: 'Notes for viewers', t: 'textarea', group: 'Sermon (church services)' },
      { k: 'musicLog', l: 'Music used (added by hand)', t: 'list', group: 'Music & report', help: 'Music that was not played from RFP Manager (a DJ, the stadium PA, a band, a vMix input without a track). Pick a track from the library, or type the title and its writers. Plays from CasparCG, vMix and stream slates are logged by themselves.', fields: [
        { k: 'track', l: 'Track', t: 'ref', ref: 'track' }, { k: 'title', l: 'or title', t: 'text' }, { k: 'composers', l: 'Composer(s)', t: 'text' }, { k: 'publisher', l: 'Publisher', t: 'text' },
        { k: 'usage', l: 'Used as', t: 'combo', opts: MUSIC_USAGE, w: 150 }, { k: 'at', l: 'Time', t: 'time', w: 100 }, { k: 'duration', l: 'Duration', t: 'text', ph: '0:30', w: 90 },
        { k: 'source', l: 'Played from', t: 'combo', opts: ['Manual', 'DJ / PA', 'Live band', 'vMix', 'ATEM', 'CasparCG', 'Other'], w: 130 }] },
      { k: 'streamChannel', l: 'Live stream on channel', t: 'ref', ref: 'channel', group: 'Live stream', help: 'Stream this production on a channel. The stream key is made for this production (shown below once saved).' },
      { k: 'streamTitle', l: 'Stream title', t: 'text', ph: 'The production name', group: 'Live stream' },
      { k: 'streamSlug', l: 'Stream web address', t: 'text', ph: 'Made from the name and date', group: 'Live stream', help: 'Viewers watch at /watch/<this>.' },
      { k: 'streamPrice', l: 'Ticket price (ZAR)', t: 'money', group: 'Live stream', help: 'Empty or 0 = free to watch. Otherwise viewers buy a ticket (PayFast) to watch live and the recordings. Only on a Public channel.' },
      { k: 'streamVisibility', l: 'Who can watch this stream', t: 'select', opts: ['', 'Public', 'Unlisted', 'Private'], group: 'Live stream', help: 'Empty: as the channel. Public: anyone, listed on the website. Unlisted: anyone with the watch link, but not listed anywhere. Private: only your production team, signed in.' },
      { k: 'streamPublicDays', l: 'Public for (days after the stream)', t: 'number', ph: 'As the channel (empty = always)', group: 'Live stream', help: 'How long the recording stays open to viewers after the stream ends. After that only your production team can watch it. Empty or 0: the channel\'s setting, else always.' },
      { k: 'streamPoster', l: 'Stream picture', t: 'image', group: 'Live stream', help: 'Shown before it starts and on the video afterwards. The channel\'s banner if empty.' },
      { k: 'streamRecord', l: 'Record the stream', t: 'bool', def: true, group: 'Live stream' },
      { k: 'streamVod', l: 'Show the recording on the website afterwards', t: 'bool', def: true, group: 'Live stream' },
      { k: 'streamAudio', l: 'Audio tracks (several languages or mixes)', t: 'list', group: 'Live stream', help: 'Leave empty for one normal sound. Otherwise one row per stereo pair you send: name it, and choose who hears it. Viewers pick a track under the video. Send the pairs as separate audio tracks over SRT (OBS: track 1 = 1+2, track 2 = 3+4 …) or as one track with all the channels.',
        fields: [{ k: 'channels', l: 'Channels', t: 'select', opts: ['1+2', '3+4', '5+6', '7+8', '9+10', '11+12', '13+14', '15+16'], w: 100 }, { k: 'name', l: 'Name', t: 'text', ph: 'ENGLISH' },
          { k: 'language', l: 'Language', t: 'select', opts: ['', 'English', 'Afrikaans', 'isiZulu', 'isiXhosa', 'Sesotho', 'Setswana', 'Sepedi', 'Xitsonga', 'siSwati', 'Tshivenda', 'isiNdebele', 'Portuguese', 'French', 'German', 'Spanish', 'Other'], w: 130 },
          { k: 'audience', l: 'Who hears it', t: 'select', opts: ['Everyone', 'Production team', 'Nobody'], def: 'Everyone', w: 175 }] },
      { k: 'streamPerMatch', l: 'Also a stream per match (several venues at once)', t: 'bool', group: 'Live stream', help: 'Each match in this production gets its own stream key and watch page, next to the production\'s own stream, so several venues can stream at the same time. The keys are shown on the production\'s Live stream card once saved.' },
      { k: 'streamRestream', l: 'Restream to other platforms', t: 'list', group: 'Live stream', help: 'While the stream is live the website sends a copy to each destination that is on: YouTube (rtmp://a.rtmp.youtube.com/live2), Facebook (rtmps://live-api-s.facebook.com:443/rtmp/), Twitch or any RTMP server. Leave Match empty for the production\'s own stream, or pick a match to restream that match\'s stream. With: what of master control goes along (logos, lower thirds, slates, ad breaks); anything but Clean is made on the server (about one processor core per choice in use), and squeeze-backs stay in the app only.',
        fields: [{ k: 'name', l: 'Name', t: 'text', ph: 'YouTube', w: 130 }, { k: 'url', l: 'Server (RTMP / RTMPS)', t: 'text', ph: 'rtmp://a.rtmp.youtube.com/live2' }, { k: 'key', l: 'Stream key', t: 'text', ph: 'From the platform' },
          { k: 'fixture', l: 'Match', t: 'ref', ref: 'fixture', w: 170 },
          { k: 'graphics', l: 'With', t: 'select', opts: ['Clean (as it comes in)', 'Logos only', 'Logos + lower thirds', 'Slates only', 'Logos + slates', 'Logos, lower thirds + slates', 'Ads only', 'Ads + slates', 'Everything (graphics, slates, ads)'], def: 'Clean (as it comes in)', w: 200 },
          { k: 'on', l: 'On', t: 'bool', def: true, w: 50 }] },
      RUNDOWN] },

    graphic: { label: 'Template graphic', plural: 'Template graphics', group: 'Live', title: (d) => d.name, cols: ['name', 'template', 'kind', 'layer'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'template', l: 'Template', t: 'text', req: true, help: 'Path inside the template folder, without .html' },
      { k: 'kind', l: 'Kind', t: 'select', opts: ['lt', 'fs', 'bug', 'wipe'], def: 'lt' }, { k: 'channel', l: 'Channel (0 = program)', t: 'number' }, { k: 'layer', l: 'Layer', t: 'number', def: 35 },
      { k: 'autoClear', l: 'Take off after (seconds)', t: 'number' }, { k: 'format', l: 'Data format', t: 'select', opts: ['', 'json', 'xml'] }, { k: 'description', l: 'Notes', t: 'text' },
      { k: 'fields', l: 'Fields', t: 'list', hidden: true, fields: [{ k: 'key', l: 'Key', t: 'text' }, { k: 'label', l: 'Label', t: 'text' }, { k: 'type', l: 'Type', t: 'text' }, { k: 'value', l: 'Value', t: 'text' }] }] },

    track: { label: 'Music track', plural: 'Music library', group: 'Music', title: (d) => [d.title, d.artist].filter(Boolean).join(' – '), cols: ['title', 'artist', 'composers', 'source', 'cleared', 'validUntil'], fields: [
      { k: 'title', l: 'Title', t: 'text', req: true }, { k: 'artist', l: 'Artist / performer', t: 'text' }, { k: 'composers', l: 'Composer(s)', t: 'text', ph: 'Name (share %), Name …', help: 'As they appear on the cue sheet.' },
      { k: 'lyricists', l: 'Lyricist(s)', t: 'text' }, { k: 'publisher', l: 'Publisher(s)', t: 'text' }, { k: 'label', l: 'Record label', t: 'text' },
      { k: 'iswc', l: 'ISWC', t: 'text', ph: 'T-123.456.789-0' }, { k: 'isrc', l: 'ISRC', t: 'text', ph: 'ZA-ABC-26-00001' }, { k: 'duration', l: 'Length', t: 'duration', w: 100 },
      { k: 'source', l: 'Source', t: 'select', opts: ['', ...MUSIC_SOURCES], group: 'Rights' }, { k: 'library', l: 'Library / catalogue', t: 'text', ph: 'Audio Network, Epidemic …', group: 'Rights' }, { k: 'catalogueNo', l: 'Catalogue no.', t: 'text', group: 'Rights' },
      { k: 'cleared', l: 'Clearance', t: 'select', opts: ['Cleared', 'Pending', 'Not cleared'], def: 'Pending', group: 'Rights', help: 'Only cleared tracks can be played from RFP Manager.' },
      { k: 'clearedFor', l: 'Cleared for', t: 'multi', opts: MUSIC_MEDIA, group: 'Rights' }, { k: 'licenceRef', l: 'Licence / agreement ref', t: 'text', group: 'Rights' },
      { k: 'validFrom', l: 'Licence from', t: 'date', group: 'Rights' }, { k: 'validUntil', l: 'Licence until', t: 'date', group: 'Rights' }, { k: 'rightsNotes', l: 'Rights notes', t: 'textarea', group: 'Rights' },
      { k: 'usage', l: 'Usual use', t: 'select', opts: MUSIC_USAGE, def: 'Background', group: 'Playout' },
      { k: 'casparClip', l: 'CasparCG media file', t: 'text', ph: 'MUSIC/CCC_THEME', group: 'Playout', help: 'The audio file in CasparCG\'s media folder. RFP Manager plays it from Graphics control → Music and logs every play.' },
      { k: 'vmixInput', l: 'vMix input title', t: 'text', ph: 'CCC Theme.mp3', group: 'Playout', help: 'When a vMix input with this title plays, the use is logged by itself.' },
      { k: 'volume', l: 'Volume %', t: 'number', ph: '100', group: 'Playout' }] },

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
      { k: 'phone', l: 'Phone', t: 'phone' }, { k: 'email', l: 'Email', t: 'text' }, { k: 'image', l: 'Photo', t: 'image' },
      { k: 'roles', l: 'Roles', t: 'multi', opts: 'crewRoles' }, { k: 'notes', l: 'Notes', t: 'textarea' },
      { k: 'unavailable', l: 'Not available', t: 'list', help: 'Days this person cannot work. Crew set these themselves on their home page; booking them then shows a clash.', fields: [{ k: 'from', l: 'From', t: 'date' }, { k: 'to', l: 'To', t: 'date' }, { k: 'note', l: 'Note', t: 'text' }] }] },

    crewRole: { label: 'Crew role', plural: 'Crew roles', group: 'Productions', title: (d) => d.name, cols: ['name', 'maxQuantity', 'rate', 'invoiceRate'], fields: [
      { k: 'name', l: 'Role', t: 'text', req: true }, { k: 'maxQuantity', l: 'Maximum per production', t: 'number' },
      { k: 'rate', l: 'Day rate (what you pay)', t: 'money' }, { k: 'invoiceRate', l: 'Invoice rate (what you charge)', t: 'money' }] },

    equipment: { label: 'Equipment', plural: 'Equipment', group: 'Productions', title: (d) => d.name, cols: ['name', 'category', 'quantity', 'condition', 'serviceDue', 'rate'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'category', l: 'Category', t: 'combo', opts: EQUIP_CATS, def: 'Video' },
      { k: 'quantity', l: 'Quantity owned', t: 'number' }, { k: 'rate', l: 'Day cost', t: 'money' }, { k: 'invoiceRate', l: 'Day invoice rate', t: 'money' },
      { k: 'serial', l: 'Serial / asset no.', t: 'text' }, { k: 'barcode', l: 'Barcode / tag', t: 'text', help: 'Scanned (or typed) when the kit goes out and comes back.' },
      { k: 'condition', l: 'Condition', t: 'select', opts: ['OK', 'Needs attention', 'In repair', 'Missing', 'Retired'], def: 'OK' },
      { k: 'serviceDue', l: 'Service / test due', t: 'date' }, { k: 'insuranceUntil', l: 'Insured until', t: 'date' }, { k: 'value', l: 'Replacement value', t: 'money' },
      { k: 'notes', l: 'Notes', t: 'textarea' }, { k: 'image', l: 'Image', t: 'image' }] },

    advert: { label: 'Advert', plural: 'Adverts', group: 'Advertising', title: (d) => [d.name, d.sponsor].filter(Boolean).join(' · '), cols: ['image', 'name', 'sponsor', 'layout', 'duration'], fields: [
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'sponsor', l: 'Sponsor / client', t: 'text' }, { k: 'sponsorEmail', l: 'Sponsor email (proof of play)', t: 'text', ph: 'marketing@sponsor.example', help: 'Gets the monthly proof-of-play report (Advertising → Sponsor reports).' },
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
      { k: 'passPrice', l: 'Channel pass price (ZAR)', t: 'money', help: 'Optional. A pass lets a viewer watch every paid stream on this channel for the number of days below.' }, { k: 'passDays', l: 'Pass valid for (days)', t: 'number', ph: '30' },
      { k: 'viewerPassword', l: 'Viewer password', t: 'text', help: 'Only used when "Who can watch" is Password.' },
      { k: 'publicDays', l: 'Streams public for (days after each stream)', t: 'number', ph: 'Empty = always', help: 'How long recordings on this channel stay open to viewers after their stream ends; after that only the production team can watch. A stream can set its own.' },
      { k: 'teamOnly', l: 'Only this production team', t: 'bool', help: 'Off: any production team can stream its productions on this channel. On: only this team\'s productions.' },
      { k: 'disabled', l: 'Switched off', t: 'bool', help: 'Hidden, and nobody can stream to it or watch it.' }] },
    booking: { label: 'Booking request', plural: 'Booking requests', group: 'Productions', title: (d) => [d.name, d.service].filter(Boolean).join(' · '), cols: ['received', 'name', 'service', 'date', 'producer', 'status'], fields: [
      { k: 'status', l: 'Status', t: 'select', opts: BOOKING_STATUS, def: 'New' },
      { k: 'producer', l: 'Producer', t: 'member', roles: ['Producer', 'Admin'], help: 'The Producer who looks after this booking. Only they (and Admins) see it; they accept or decline it.' },
      { k: 'name', l: 'Name', t: 'text', req: true }, { k: 'email', l: 'Email', t: 'text' }, { k: 'phone', l: 'Phone', t: 'phone' }, { k: 'organisation', l: 'Organisation', t: 'text' },
      { k: 'service', l: 'Service', t: 'text' }, { k: 'date', l: 'Date of the event', t: 'date' }, { k: 'endDate', l: 'Last day', t: 'date' }, { k: 'startTime', l: 'Starts at', t: 'time' }, { k: 'endTime', l: 'Ends at', t: 'time' },
      { k: 'venue', l: 'Where', t: 'text' }, { k: 'town', l: 'Town / city', t: 'text' }, { k: 'contactBy', l: 'Best way to reach them', t: 'combo', opts: ['WhatsApp', 'Email', 'Phone call'] }, { k: 'budget', l: 'Budget', t: 'text' }, { k: 'heard', l: 'Heard about us from', t: 'text' },
      { k: 'details', l: 'What they asked', t: 'textarea' }, { k: 'notes', l: 'Our notes', t: 'textarea' }, { k: 'received', l: 'Received', t: 'text', help: 'When the request came in from the website.' },
      { k: 'production', l: 'Production', t: 'ref', ref: 'production', help: 'The production made for this booking.' },
      { k: 'deposit', l: 'Deposit (ZAR)', t: 'money', help: 'Optional. The client can pay it with PayFast on their tracking page; once paid the booking is Booked.' },
      { k: 'clientStage', l: 'Client sees', t: 'select', opts: ['', ...BOOKING_STAGES], help: 'Empty: the step follows the work (producer, quote sent, confirmed, crew booked, the date, completed). Choose one to set it by hand.' },
      { k: 'quiet', l: 'Quiet', t: 'bool', help: 'On: the client is not sent a message when the step changes (replies still go).' }] },
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

  const SYSTEM_TYPES = ['org', 'member', 'image', 'adlog', 'playlog', 'musicuse', 'songuse', 'bible', 'product', 'user', 'machinekey', 'purchase', 'streamclip', 'comment', 'viewstat', 'streamvideo', 'mcr', 'videoad', 'adpreset', 'pushdevice', 'notification'];
  const ALL_TYPES = [...Object.keys(E), ...SYSTEM_TYPES];

  const has = (v) => v !== undefined && v !== null && v !== '';
  // A team inherits name, colours and logo from its club unless it sets its own.
  function resolveSquad(squad, club) {
    const s = squad || {}, c = club || {};
    const pick = (k) => (has(s[k]) ? s[k] : c[k]);
    const name = pick('name') || '';
    return { name, graphicName: (has(s.graphicName) ? s.graphicName : has(s.name) ? s.name : c.graphicName) || name, abbreviation: pick('abbreviation') || name.slice(0, 3).toUpperCase(),
      primaryColor: pick('primaryColor') || '#ffffff', secondaryColor: pick('secondaryColor') || '#262626', image: pick('image') || '',
      primaryTextColor: pick('primaryTextColor') || '', secondaryTextColor: pick('secondaryTextColor') || '', fullGraphicName: pick('fullGraphicName') || '',
      kits: { home: [c.homeKit1 || '', c.homeKit2 || ''], away: [c.awayKit1 || '', c.awayKit2 || ''], alt: [c.altKit1 || '', c.altKit2 || ''] }, defaultVenue: c.defaultVenue || '',
      sport: s.sport || '', ageGroup: s.ageGroup || '', gender: s.gender || '', division: s.division || '', coach: s.coach || '', players: s.players || [] };
  }

  // The match settings in force: the match's own, else its competition's. Booleans on a match are '', 'Yes' or 'No'.
  function matchSettings(fixture, comp) {
    const f = fixture || {}, c = comp || {}, out = {};
    const num = (v) => (has(v) && Number(v) >= 0 && v !== '' ? Number(v) : null);
    for (const k of ['totalPeriods', 'periodLength', 'breakLength', 'sinbinMin', 'lineupSize', 'benchSize', 'fieldGoalPoints']) { const v = num(f[k]) ?? num(c[k]); if (v !== null) out[k] = v; }
    for (const k of ['overtime', 'goldenPoint', 'kickingComp', 'red20']) {
      const v = f[k] === 'Yes' || f[k] === true ? true : f[k] === 'No' || f[k] === false ? false : has(c[k]) ? !!c[k] : null;
      if (v !== null) out[k] = v;
    }
    out.statCoverage = f.statCoverage || c.statCoverage || 'Standard';
    out.playerEvents = f.playerEvents || c.playerEvents || 'All';
    return out;
  }

  // What a team looks like on air: name, colours, logo and squad list. get(id) returns a record's data.
  function snapshotTeam(get, squadId, fallback) {
    const squad = squadId ? get(squadId) : null;
    if (!squad) return { id: '', name: fallback, full: fallback, short: String(fallback).slice(0, 3).toUpperCase(), color1: '#ffffff', color2: '#262626', logo: '', coach: '', players: [] };
    const r = resolveSquad(squad, squad.club ? get(squad.club) : null);
    const players = [];
    for (const row of r.players) {
      const p = row.player ? get(row.player) : null;
      if (!p) continue;
      const gfx = [p.graphicFirstName || p.name, p.graphicLastName || p.surname].filter(Boolean).join(' ');
      players.push({ id: row.player, number: String(row.number || ''), name: [p.name, p.surname].filter(Boolean).join(' '), gfxName: p.graphicFirstName || p.graphicLastName ? gfx : '',
        position: row.position || p.position || '', positionType: row.positionType || p.positionType || '', captain: !!row.captain, starter: row.bench ? false : row.starter === undefined ? undefined : !!row.starter, image: p.image || '' });
    }
    return { id: squadId, name: r.graphicName || r.name, full: [r.name, r.ageGroup].filter(Boolean).join(' '), long: r.fullGraphicName || r.name, short: r.abbreviation, color1: r.primaryColor, color2: r.secondaryColor,
      text1: r.primaryTextColor, text2: r.secondaryTextColor, kits: r.kits, logo: r.image, coach: r.coach, players };
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

  return { ENTITIES: E, REPORT_ASPECTS, ISSUE_SEVERITY, PRODUCTION_STATUS, MUSIC_USAGE, MUSIC_SOURCES, MUSIC_MEDIA, GENDERS, AGE_GROUPS, DIVISIONS, POSITION_TYPES, matchSettings, LINE_COLORS, ROLES, STATUSES, PRODUCTION_TYPES, SOURCES, EQUIP_CATS, SYSTEM_TYPES, ALL_TYPES, PC_EDIT, ROLE_SEES, EXPENSE_CATS, EXPENSE_STATUS, BOOKING_STATUS, BOOKING_STAGES, officiates, sees, resolveSquad, snapshotTeam, fieldsFor, age,
    parseDuration, fmtDuration, rundownTimes, costing, CAN };
});
