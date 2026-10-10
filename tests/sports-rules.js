// Run: node tests/sports.test.js
const S = require('../shared/sports.js');
let pass = 0, fail = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  exp', JSON.stringify(b)); } };
const ev = (type, o) => Object.assign({ id: Math.random().toString(36).slice(2), type }, o);
const setup = (sport, variant, extra) => Object.assign(S.newSetup(sport, variant), extra || {});
const pts = (team, n, how) => Array.from({ length: n }, () => ev('point', { team, how }));

// ---------------- tennis
{
  const su = setup('tennis', 'bo3');
  let v = S.compute(su, pts('A', 3));
  eq([v.extra.points.A, v.extra.points.B], ['40', '0'], 'tennis 40-0');
  eq(v.extra.flag, '', 'server A holding – no break point');
  v = S.compute(su, [...pts('B', 3)]);
  eq(v.extra.flag, 'BREAK POINT', 'B 0-40 on A serve = break point');
  // deuce and advantage
  v = S.compute(su, [...pts('A', 3), ...pts('B', 3), ...pts('A', 1)]);
  eq([v.extra.points.A, v.extra.points.B], ['AD', '40'], 'advantage A');
  v = S.compute(su, [...pts('A', 3), ...pts('B', 3), ...pts('A', 1), ...pts('B', 1)]);
  eq(v.status.startsWith('DEUCE') || v.extra.flag === 'DEUCE', true, 'back to deuce');
  // win a game: server alternates
  v = S.compute(su, pts('A', 4));
  eq([v.extra.games.A, v.extra.games.B, v.extra.server], [1, 0, 'B'], 'game A, B serves');
  // 6-0 set
  v = S.compute(su, pts('A', 24));
  eq([v.score.A, v.table.A[0], v.table.B[0]], ['1', '6', '0'], 'set 6-0');
  // tie-break at 6-6: alternate games
  const toSix = [];
  for (let g = 0; g < 12; g++) toSix.push(...pts(g % 2 === 0 ? 'A' : 'B', 4));
  v = S.compute(su, toSix);
  eq([v.extra.games.A, v.extra.games.B, v.extra.tiebreak], [6, 6, true], '6-6 tiebreak');
  v = S.compute(su, [...toSix, ...pts('A', 7)]);
  eq([v.score.A, v.table.A[0], v.table.B[0]], ['1', '7', '6(0)'], 'tiebreak 7-6(0)');
  // match: two sets 6-0
  v = S.compute(su, pts('A', 48));
  eq([v.finished, v.winner], [true, 'A'], 'match won 6-0 6-0');
  // set point / match point flags
  v = S.compute(su, [...pts('A', 24), ...pts('A', 20), ...pts('A', 3)]);
  eq(v.extra.flag, 'MATCH POINT', 'match point at 6-0 5-0 40-0');
}
// ---------------- padel golden point + super tiebreak
{
  const su = setup('padel', 'super');
  let v = S.compute(su, [...pts('A', 3), ...pts('B', 3)]);
  eq(v.extra.flag, 'GOLDEN POINT', 'padel golden point at 40-40');
  v = S.compute(su, [...pts('A', 3), ...pts('B', 3), ...pts('B', 1)]);
  eq([v.extra.games.A, v.extra.games.B], [0, 1], 'golden point decides game');
  // sets 1-1 then super tiebreak to 10
  v = S.compute(su, [...pts('A', 24), ...pts('B', 24)]);
  eq([v.extra.tiebreak, v.periodLabel], [true, 'MATCH TIE-BREAK'], 'super tiebreak starts');
  v = S.compute(su, [...pts('A', 24), ...pts('B', 24), ...pts('A', 10)]);
  eq([v.finished, v.winner, v.table.A[2]], [true, 'A', '1(10)'], 'super tiebreak won 10-0');
}
// ---------------- badminton
{
  const su = setup('badminton');
  let v = S.compute(su, pts('A', 21));
  eq([v.score.A, v.table.A[0]], ['1', '21'], 'game 21-0');
  const deuce = [];
  for (let i = 0; i < 29; i++) deuce.push(...pts('A', 1), ...pts('B', 1));
  v = S.compute(su, [...deuce, ...pts('A', 1)]);
  eq([v.score.A, v.table.A[0], v.table.B[0]], ['1', '30', '29'], 'cap at 30');
  v = S.compute(su, pts('A', 20));
  eq(v.extra.flag, 'GAME POINT', 'game point at 20-0');
}
// ---------------- volleyball
{
  const su = setup('volleyball', 'indoor');
  let v = S.compute(su, [...pts('A', 75)]);
  eq([v.finished, v.score.A], [true, '3'], '3-0 in sets');
  const four = [...pts('A', 25), ...pts('B', 25), ...pts('A', 25), ...pts('B', 25)];
  v = S.compute(su, [...four, ...pts('A', 14)]);
  eq([v.extra.target, v.extra.flag], [15, 'MATCH POINT'], '5th set to 15, match point at 14');
  v = S.compute(su, [...four, ...pts('A', 8)]);
  eq(v.status, 'CHANGE OF COURTS', 'change courts at 8 in 5th');
}
// ---------------- rugby
{
  const su = setup('rugby', 'union');
  su.teams.A.players = [{ id: 'p1', name: 'Handre Pollard', number: 10 }];
  let v = S.compute(su, [ev('score', { team: 'A', key: 'try', player: 'p1', gt: 60000, ct: '01:00' }), ev('score', { team: 'A', key: 'conv', player: 'p1' }),
    ev('score', { team: 'B', key: 'pen' }), ev('miss', { team: 'A', key: 'pen_miss', player: 'p1' })]);
  eq([v.score.A, v.score.B], ['7', '3'], 'try+conv v pen');
  eq(v.teamStats.find(s => s.label === 'PENALTY GOALS').a, '0/1 (0%)', 'penalty %');
  eq(v.players[0].statsText, '1 TR · 1 CON · 7 PTS', 'player line');
  eq(v.flat.scorersA.startsWith('#10 HANDRE POLLARD 01:00'), true, 'scorers list');
  v = S.compute(su, [ev('card', { team: 'B', key: 'yellow', gt: 600000 })]);
  eq(v.sinbins[0].untilGt, 1200000, 'sin bin 10 min');
  const lg = setup('rugby', 'league');
  v = S.compute(lg, [ev('score', { team: 'A', key: 'try' }), ev('score', { team: 'A', key: 'drop' })]);
  eq(v.score.A, '5', 'league try 4 + drop 1');
  v = S.compute(su, [ev('period', { to: 2 })]);
  eq([v.periodLabel, v.clock.game.startMs, v.clock.game.limitMs], ['SECOND HALF', 2400000, 4800000], 'second half clock 40-80');
}
// ---------------- basketball
{
  const su = setup('basketball', 'fiba');
  su.teams.A.players = [{ id: 'b1', name: 'Player One', number: 23 }];
  const fouls = Array.from({ length: 5 }, () => ev('foul', { team: 'A', player: 'b1' }));
  let v = S.compute(su, [ev('score', { team: 'A', key: 'three', player: 'b1' }), ev('score', { team: 'A', key: 'two', player: 'b1' }), ev('score', { team: 'A', key: 'ft', player: 'b1' }), ev('miss', { team: 'A', key: 'fg_miss', player: 'b1' }), ...fouls]);
  eq(v.score.A, '6', '3+2+1');
  eq(v.teamStats[0].a, '2/3 (67%)', 'FG%');
  eq(v.extra.bonus.B, true, 'B in bonus after 5 A fouls');
  eq(v.timeline[v.timeline.length - 1].text.includes('FOULED OUT'), true, 'fouled out at 5');
  eq(v.clock.shot.limitMs, 24000, 'shot clock 24');
  v = S.compute(su, [ev('period', { to: 5 })]);
  eq(v.periodLabel, 'OT1', 'overtime label');
}
// ---------------- netball
{
  const su = setup('netball', 'super');
  let v = S.compute(su, [ev('score', { team: 'A', key: 'goal' }), ev('score', { team: 'B', key: 'super' }), ev('miss', { team: 'A', key: 'miss' })]);
  eq([v.score.A, v.score.B], ['1', '2'], 'goal + super shot');
  eq(v.teamStats[0].a, '1/2 (50%)', 'shooting %');
  eq(v.extra.centrePass, 'A', 'centre pass alternates after 2 goals back to A');
}
// ---------------- hockey shootout
{
  const su = setup('hockey');
  let v = S.compute(su, [ev('score', { team: 'A', key: 'goal' }), ev('score', { team: 'B', key: 'pc_goal' }), ev('period', { to: 5 }),
    ev('shootout', { team: 'A', scored: true }), ev('shootout', { team: 'B', scored: false }), ev('end', {})]);
  eq([v.score.A, v.score.B, v.winner, v.flat.shootout_textA], ['1', '1', 'A', '●'], 'hockey shootout decides');
}
// ---------------- baseball
{
  const su = setup('baseball');
  su.teams.A.players = Array.from({ length: 9 }, (_, i) => ({ id: 'a' + i, name: 'Away ' + i, number: i + 1 }));
  su.teams.B.players = Array.from({ length: 9 }, (_, i) => ({ id: 'h' + i, name: 'Home ' + i, number: i + 11 }));
  let v = S.compute(su, [ev('pitch', { kind: 'ball' }), ev('pitch', { kind: 'strike' }), ev('pitch', { kind: 'foul' }), ev('pitch', { kind: 'foul' })]);
  eq([v.extra.balls, v.extra.strikes], [1, 2], 'count 1-2 (foul with 2 strikes stays)');
  v = S.compute(su, [ev('hit', { bases: 1 }), ev('hit', { bases: 1 }), ev('hit', { bases: 4 })]);
  eq([v.score.A, v.flat.hitsA, v.extra.bases], ['3', '3', [false, false, false]], '3-run homer');
  const walks = Array.from({ length: 4 }, () => ev('walk', {}));
  v = S.compute(su, walks);
  eq([v.score.A, v.extra.bases], ['1', [true, true, true]], 'bases-loaded walk scores');
  const threeOuts = Array.from({ length: 3 }, () => ev('out', { how: 'fly' }));
  v = S.compute(su, threeOuts);
  eq([v.extra.half, v.extra.inning, v.periodLabel], [1, 1, 'BOTTOM 1ST'], 'three outs switch half');
  const inning = [...threeOuts, ...threeOuts];
  const game = [];
  for (let i = 0; i < 8; i++) game.push(...inning);
  v = S.compute(su, [...game, ev('hit', { bases: 4 }), ...threeOuts]);
  eq([v.finished, v.winner, v.table.B[8]], [false, null, '0'], 'top 9 away leads; home now batting in 9th');
  v = S.compute(su, [...game, ...threeOuts, ev('hit', { bases: 4 })]);
  eq([v.finished, v.winner], [true, 'B'], 'walk-off homer in bottom 9th');
  v = S.compute(su, [...game, ev('hit', { bases: 4 }), ...threeOuts, ...threeOuts]);
  eq([v.finished, v.winner], [true, 'A'], 'away wins after bottom 9th');
}
// ---------------- athletics
{
  const su = setup('athletics');
  su.ath = { current: 'e1', events: [{ id: 'e1', name: "Men's 100m", round: 'Final', kind: 'track', entries: [
    { id: 'r1', lane: 4, name: 'Akani Simbine', team: 'RSA', pb: '9.82' }, { id: 'r2', lane: 5, name: 'Other Runner', team: 'KEN' }, { id: 'r3', lane: 3, name: 'Third Guy', team: 'USA' }] },
    { id: 'e2', name: 'Long jump', kind: 'field', entries: [{ id: 'j1', name: 'Jumper One' }, { id: 'j2', name: 'Jumper Two' }] }] };
  let v = S.compute(su, []);
  eq(v.flat.sl1_lane, '3', 'start list by lane');
  v = S.compute(su, [ev('result', { eventId: 'e1', entry: 'r1', value: '9.95', note: 'SB' }), ev('result', { eventId: 'e1', entry: 'r2', value: '10.01' }), ev('result', { eventId: 'e1', entry: 'r3', value: 'DNF' })]);
  eq([v.flat.rs1_name, v.flat.rs1_rank, v.flat.rs2_rank, v.flat.rs3_result, v.flat.ath_winner_result], ['AKANI SIMBINE', '1', '2', 'DNF', '9.95'], 'results ranking + DNF last');
  su.ath.current = 'e2';
  v = S.compute(su, [ev('attempt', { eventId: 'e2', entry: 'j1', value: '7.80' }), ev('attempt', { eventId: 'e2', entry: 'j1', value: 'X' }), ev('attempt', { eventId: 'e2', entry: 'j2', value: '8.01' })]);
  eq([v.flat.rs1_name, v.flat.rs1_result, v.flat.rs2_attempts], ['JUMPER TWO', '8.01', '7.80 X'], 'field best attempt ranking');
}
// ---------------- flat keys common
{
  const v = S.compute(setup('rugby'), []);
  eq(['teamA_name', 'scoreA', 'period', 'table_cols', 'col1', 'stat1_label'].every(k => k in v.flat), true, 'flat common keys');
  eq(S.list().length, 11, 'eleven sports registered');
}

// ---------------- federation rules added in RFP Manager
{
  // World Rugby: 20-minute red card behaves like a 20-minute sin bin; bonus points
  const su = setup('rugby', 'union');
  let v = S.compute(su, [ev('card', { key: 'red20', team: 'A', gt: 60000 }), ev('card', { key: 'yellow', team: 'B', gt: 120000 })]);
  eq(v.sinbins.map(x => [x.card, (x.untilGt - 0) / 60000]), [['red20', 21], ['yellow', 12]], 'rugby red20 = 20 min, yellow = 10 min');
  eq(v.teamStats.find(x => x.label === 'RED CARDS').a, '1', 'red20 counted as a red card');
  v = S.compute(su, [...Array.from({ length: 4 }, () => ev('score', { key: 'try', team: 'A' })), ev('score', { key: 'try', team: 'B' }), ev('score', { key: 'try', team: 'B' }), ev('score', { key: 'pen', team: 'B' }), ev('end', {})]);
  eq([v.score.A, v.score.B], ['20', '13'], 'rugby 20-13');
  eq([v.extra.bonusPts.A.log, v.extra.bonusPts.B.log, v.flat.trybonusA, v.flat.losingbonusB], [5, 1, 'TRY BONUS', 'LOSING BONUS'], 'rugby log points with bonus points');
  eq(S.compute(setup('rugby', 'sevens'), [ev('card', { key: 'yellow', team: 'A', gt: 0 })]).sinbins[0].untilGt, 120000, 'sevens yellow = 2 min');
  // FIH hockey: green 2, yellow 5 or 10
  v = S.compute(setup('hockey', 'quarters'), [ev('card', { key: 'green', team: 'A', gt: 0 }), ev('card', { key: 'yellow', team: 'A', gt: 0 }), ev('card', { key: 'yellow10', team: 'B', gt: 0 })]);
  eq(v.sinbins.map(x => x.untilGt / 60000), [2, 5, 10], 'hockey suspensions 2 / 5 / 10 min');
  eq(v.teamStats.find(x => x.label === 'YELLOW CARDS').b, '1', 'hockey 10-min yellow counted');
  // World Netball: warning has no time, suspension 2 min, centre pass alternates
  v = S.compute(setup('netball', 'standard'), [ev('card', { key: 'warning', team: 'A', gt: 0 }), ev('card', { key: 'yellow', team: 'A', gt: 0 }), ev('score', { key: 'goal', team: 'A' })]);
  eq([v.sinbins.length, v.sinbins[0].untilGt, v.extra.centrePass], [1, 120000, 'B'], 'netball warning / suspension / centre pass');
  // IFAB football: second yellow = red; own goal counts for the team; penalties decide a draw
  const pl = { teams: { A: { name: 'Home', players: [{ id: 'p9', name: 'Nine', number: 9 }] }, B: { name: 'Away', players: [] } } };
  const fb = setup('football', 'standard', pl);
  v = S.compute(fb, [ev('card', { key: 'yellow', team: 'A', player: 'p9' }), ev('card', { key: 'yellow', team: 'A', player: 'p9' }), ev('score', { key: 'own_goal', team: 'B' }), ev('score', { key: 'goal', team: 'A', player: 'p9' })]);
  eq([v.extra.reds.length, v.score.A, v.score.B, v.teamStats[0].b, v.clock.game.dir], [1, '1', '1', '1', 1], 'football second yellow, own goal, clock counts up');
  v = S.compute(fb, [ev('period', { to: 5 }), ev('shootout', { team: 'A', scored: true }), ev('shootout', { team: 'B', scored: false }), ev('end', {})]);
  eq([v.winner, v.periodLabel], ['A', 'FULL TIME'], 'football shoot-out winner');
  // ITF tennis: standard = 7-point tie-break in the final set, Grand Slam = 10
  const game = t => pts(t, 4), set = t => Array.from({ length: 6 }, () => game(t)).flat();
  const sixAll = Array.from({ length: 12 }, (_, g) => game(g % 2 ? 'B' : 'A')).flat();
  v = S.compute(setup('tennis', 'itf3'), [...set('A'), ...set('B'), ...sixAll, ...pts('A', 7)]);
  eq([v.finished, v.winner], [true, 'A'], 'ITF standard final set tie-break to 7');
  v = S.compute(setup('tennis', 'bo3'), [...set('A'), ...set('B'), ...sixAll, ...pts('A', 7)]);
  eq([v.finished, v.extra.tiebreak], [false, true], 'Grand Slam final set tie-break goes to 10');
  v = S.compute(setup('tennis', 'adv'), [...set('A'), ...set('B'), ...sixAll]);
  eq(v.extra.tiebreak, false, 'advantage final set has no tie-break');
  v = S.compute(setup('tennis', 'short'), [...Array.from({ length: 4 }, () => game('A')).flat()]);
  eq(v.score.A, '1', 'short sets: first to 4 games');
}
// ---------------- full match statistics
{
  const st = (v, label) => { const s = v.teamStats.find(x => x.label === label); return s ? [s.a, s.b] : null; };
  // rugby: possession and territory by time, tackle and set-piece percentages, player totals
  let su = setup('rugby', 'union', { teams: { A: { name: 'Home', players: [{ id: 'p1', name: 'One', number: 7 }] }, B: { name: 'Away', players: [] } } });
  let v = S.compute(su, [ev('share', { key: 'poss', team: 'A', gt: 0 }), ev('share', { key: 'terr', team: 'B', gt: 0 }),
    ev('stat', { key: 'tackle', team: 'A', player: 'p1', gt: 60000 }), ev('stat', { key: 'tackle', team: 'A', player: 'p1', gt: 70000 }), ev('stat', { key: 'tackle_miss', team: 'A', player: 'p1', gt: 80000 }),
    ev('stat', { key: 'lineout_won', team: 'B', gt: 100000 }), ev('stat', { key: 'lineout_lost', team: 'B', gt: 110000 }), ev('stat', { key: 'scrum_won', team: 'A', gt: 115000 }),
    ev('share', { key: 'poss', team: 'B', gt: 120000 }), ev('stat', { key: 'carry', team: 'B', gt: 160000 })]);
  eq(st(v, 'POSSESSION'), ['75%', '25%'], 'rugby possession by time');
  eq(st(v, 'TERRITORY'), ['0%', '100%'], 'rugby territory');
  eq(st(v, 'TACKLES MADE'), ['2/3 (67%)', '0/0'], 'tackle success');
  eq(st(v, 'LINEOUTS WON'), ['0/0', '1/2 (50%)'], 'lineouts on own throw');
  eq(st(v, 'SCRUMS WON'), ['1/1 (100%)', '0/0'], 'scrums');
  eq([v.players[0].stats.tackle, v.players[0].stats.tackle_att, v.leaders.find(l => l.label === 'MOST TACKLES').value], [2, 3, 2], 'player tackles');
  eq(v.score, { A: '0', B: '0' }, 'statistics never change the score');
  eq(S.compute(su, []).teamStats.find(x => x.label === 'POSSESSION').a, '–', 'possession blank until it is tracked');
  // a period break stops the share clock
  v = S.compute(su, [ev('share', { key: 'poss', team: 'A', gt: 0 }), ev('period', { to: 2, gt: 60000 }), ev('stat', { key: 'carry', team: 'B', gt: 2400000 + 60000 })]);
  eq(st(v, 'POSSESSION'), ['100%', '0%'], 'share stops at the period change');
  // hockey: penalty corner conversion, saves
  su = setup('hockey', 'quarters');
  v = S.compute(su, [ev('stat', { key: 'pc', team: 'A' }), ev('stat', { key: 'pc', team: 'A' }), ev('score', { key: 'pc_goal', team: 'A' }), ev('stat', { key: 'save', team: 'B' }), ev('stat', { key: 'ref_lost', team: 'B' })]);
  eq([st(v, 'PC CONVERSION'), st(v, 'SAVES'), st(v, 'VIDEO REFERRALS'), v.score.A], [['1/2 (50%)', '0/0'], ['0', '1'], ['0/0', '0/1 (0%)'], '1'], 'hockey stats');
  // netball: detail rolls up into the headline numbers
  su = setup('netball', 'standard');
  v = S.compute(su, [ev('stat', { key: 'intercept', team: 'A' }), ev('stat', { key: 'gain', team: 'A' }), ev('stat', { key: 'contact', team: 'B' }), ev('stat', { key: 'obstruction', team: 'B' }), ev('stat', { key: 'bad_pass', team: 'B' }), ev('stat', { key: 'goal_assist', team: 'A' })]);
  eq([st(v, 'GAINS'), st(v, 'INTERCEPTS'), st(v, 'PENALTIES'), st(v, 'CONTACT PENALTIES'), st(v, 'TURNOVERS'), st(v, 'FEEDS'), st(v, 'GOAL ASSISTS')], [['2', '0'], ['1', '0'], ['0', '2'], ['0', '1'], ['0', '1'], ['1', '0'], ['1', '0']], 'netball roll-ups');
  // football and basketball
  v = S.compute(setup('football', 'standard'), [ev('stat', { key: 'shot_on', team: 'A' }), ev('stat', { key: 'shot_off', team: 'A' }), ev('stat', { key: 'shot_blk', team: 'A' }), ev('score', { key: 'goal', team: 'A' })]);
  eq(st(v, 'TOTAL SHOTS'), ['4', '0'], 'football total shots');
  v = S.compute(setup('basketball', 'fiba'), [ev('stat', { key: 'oreb', team: 'A' }), ev('stat', { key: 'reb', team: 'A' }), ev('stat', { key: 'reb', team: 'A' })]);
  eq([st(v, 'REBOUNDS'), st(v, 'OFFENSIVE REBOUNDS'), st(v, 'DEFENSIVE REBOUNDS')], [['3', '0'], ['1', '0'], ['2', '0']], 'basketball rebounds');
  // tennis: first and second serve, net points, receiving
  su = setup('tennis', 'itf3');
  v = S.compute(su, [ev('point', { team: 'A', how: 'ace', serve: 1 }), ev('point', { team: 'B', how: 'df' }), ev('point', { team: 'A', serve: 2, net: 'A' }), ev('point', { team: 'B', serve: 1, net: 'AB', how: 'winner' })]);
  eq([st(v, '1ST SERVE IN'), st(v, '1ST SERVE POINTS WON'), st(v, '2ND SERVE POINTS WON'), st(v, 'NET POINTS WON'), st(v, 'RECEIVING POINTS WON'), st(v, 'DOUBLE FAULTS')],
    [['50%', '–'], ['50%', '–'], ['50%', '–'], ['1/2', '1/1'], ['–', '50%'], ['1', '0']], 'tennis serve and net stats');
  // volleyball: named errors are charged to the side that made them
  v = S.compute(setup('volleyball', 'indoor'), [ev('point', { team: 'A', how: 'svc_err' }), ev('point', { team: 'A', how: 'ace' }), ev('point', { team: 'B', how: 'attack' })]);
  eq([st(v, 'SERVICE ERRORS'), st(v, 'ERRORS'), st(v, 'ACES'), st(v, 'ATTACK POINTS'), st(v, 'POINTS WON')], [['0', '1'], ['0', '1'], ['1', '0'], ['0', '1'], ['2', '1']], 'volleyball stats');
  // every stat button belongs to a category and every stat it feeds is in the team table
  for (const id of ['rugby', 'hockey', 'football', 'netball']) {
    const acts = S.actions(id).filter(a => a.group === 'stats'), def = S.SPORTS[id];
    const shown = new Set(def.teamStats.flatMap(s => [s.key, s.made, s.att, ...(s.sum || [])]).filter(Boolean));
    eq(acts.filter(a => !a.cat).map(a => a.key), [], id + ' stat categories');
    eq(acts.filter(a => !shown.has(a.stat || a.key) && !shown.has(a.also) && !shown.has(a.attempt)).map(a => a.key), [], id + ' every stat is reported');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
