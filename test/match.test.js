/**
 * Headless match tests: node test/match.test.js
 *
 * The harness is what a trainer will run millions of times, so the two things
 * that matter are that a rack plays to a finish and that the same seed gives
 * the same rack. The third is subtler and easy to get wrong: the searching bot
 * plays trial shots on the live table and puts it back afterwards, and a leak
 * there would quietly corrupt every game after it while still looking like a
 * legal match.
 */
var Phys = require('../phys.js');
var Rules = require('../rules.js');
var Match = require('../train/match.js');
var Bot = require('../train/bot.js');
var Geometry = require('../train/geometry.js');

var failures = 0;

function check(name, ok, detail) {
    if (ok) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? ' -> ' + detail : ''));
    }
}

/** Everything a restore has to put back, orientation included. */
function layout(world) {
    return world.balls.map(function (b) {
        var q = b.body.quaternion;
        return b.id + ':' + (b.active ? b.x.toFixed(9) + ',' + b.y.toFixed(9) : 'off') +
            ':' + [q.x, q.y, q.z, q.w].map(function (n) { return n.toFixed(9); }).join(',');
    }).join('|');
}

/* ------------------------------------------------------------------ */

console.log('the rack');

var a = Match.setup(Match.rng(7));
var b = Match.setup(Match.rng(7));
check('the same seed racks the same balls', layout(a) === layout(b));
check('a different seed does not',
    layout(a) !== layout(Match.setup(Match.rng(8))));

check('the cue ball starts in hand', !a.ball(0).active);
check('every object ball is on the table',
    a.balls.filter(function (x) { return x.active; }).length === 15);

var byX = a.balls.filter(function (x) { return x.active; })
    .sort(function (p, q) { return p.x - q.x; });
check('the 1 ball is on the foot spot', byX[0].id === 1, String(byX[0].id));
check('the 8 ball is in the middle of the rack', byX[4].id === 8 ||
    byX[3].id === 8 || byX[5].id === 8, 'row three holds ' +
    byX.slice(3, 6).map(function (x) { return x.id; }).join());

var back = byX.slice(-5).map(function (x) { return x.id; }).sort(function (p, q) { return p - q; });
check('the back row corners hold one of each half',
    Rules.groupOf(back[0]) !== Rules.groupOf(back[back.length - 1]),
    back.join());

console.log('playing a shot');

var w = Match.setup(Match.rng(3));
w.ball(0).placeAt(Match.TABLE_W * 0.22, Match.TABLE_H / 2);
var pos = {groups: [null, null], player: 0, open: true, broken: false};
var out = Match.playShot(w, pos, {angle: 0, power: 8, side: 0, vert: 0, elevation: 0});

check('the shot is judged', typeof out.foul !== 'undefined' && !!out.shot);
check('it hit something', out.shot.first !== null, String(out.shot.first));
check('the table comes back to rest', w.atRest());
check('it reports how long the table ran', out.seconds > 0 && out.seconds < 40,
    out.seconds.toFixed(1));

console.log('undoing a trial shot');

var trial = Match.setup(Match.rng(21));
trial.ball(0).placeAt(0.5, 0.56);
Match.settle(trial, Rules.newShot(trial, [null, null], 0, false), 3);

var before = layout(trial);
var snap = Bot.snapshot(trial);
Match.playShot(trial, {groups: [null, null], player: 0, open: true, broken: true},
    {angle: 0.05, power: 7, side: 0.4, vert: -0.3, elevation: 0});
check('a trial shot really does move the table', layout(trial) !== before);

Bot.restore(trial, snap);
check('putting it back is exact', layout(trial) === before);
check('nothing is left rolling', trial.atRest());

// the real test: the same shot from the restored table has to do the same thing
function replay(world) {
    var p = {groups: [null, null], player: 0, open: true, broken: true};
    var r = Match.playShot(world, p, {angle: -0.12, power: 5, side: 0, vert: 0, elevation: 0});
    return r.shot.first + '|' + r.shot.potted.slice().sort().join() + '|' + layout(world);
}
var fresh = Match.setup(Match.rng(21));
fresh.ball(0).placeAt(0.5, 0.56);
Match.settle(fresh, Rules.newShot(fresh, [null, null], 0, false), 3);

check('and the next shot plays out identically', replay(trial) === replay(fresh));

console.log('the baseline bot');

var bot = Bot.create({seed: 5});
var table = Match.setup(Match.rng(31));
var bpos = {groups: [null, null], player: 0, open: true, broken: false,
    ballInHand: true, kitchenOnly: true};

var spot = bot.place(table, bpos);
check('it offers a legal spot behind the line',
    spot && Rules.placementLegal(table, spot.x, spot.y, true), JSON.stringify(spot));

table.ball(0).placeAt(spot.x, spot.y);
var breakParams = bot.shoot(table, bpos);
check('it offers a break', breakParams && breakParams.power > 6,
    JSON.stringify(breakParams));

// mid game: it should find the pot the geometry says is there
var mid = Phys.createTable({width: Match.TABLE_W, height: Match.TABLE_H});
mid.add(new Phys.Ball(0, 0.5, 0.35));
mid.add(new Phys.Ball(1, 0.25, 0.2));
mid.add(new Phys.Ball(9, 1.8, 0.9));
var mpos = {groups: ['solids', 'stripes'], player: 0, open: false, broken: true};
var shortlist = Geometry.candidates(mid, Rules.legalBalls(mid, mpos.groups, 0));
var chosen = Bot.create({seed: 2, noise: 0}).shoot(mid, mpos);
check('it takes the pot the geometry found', shortlist.length > 0 && chosen &&
    Math.abs(chosen.angle - shortlist[0].angle) < 0.01,
    shortlist.length ? chosen.angle.toFixed(3) + ' vs ' + shortlist[0].angle.toFixed(3) : 'nothing on');

// snookered: it must still offer something rather than give up
var stuck = Phys.createTable({width: Match.TABLE_W, height: Match.TABLE_H});
stuck.add(new Phys.Ball(0, 0.3, 0.56));
stuck.add(new Phys.Ball(1, 1.9, 0.56));
for (var k = 2; k < 8; k++) stuck.add(new Phys.Ball(k, 1.0, 0.3 + (k - 2) * 2.1 * stuck.radius));
var spos = {groups: ['solids', 'stripes'], player: 0, open: false, broken: true};
var stuckShot = Bot.create({seed: 3}).shoot(stuck, spos);
check('with nothing on it still plays a safety',
    stuckShot && stuckShot.power > 0, JSON.stringify(stuckShot));

console.log('a whole rack');

var players = [Bot.create({seed: 101}), Bot.create({seed: 202})];
var game = Match.playGame(players, {seed: 42});
check('somebody wins', game.winner === 0 || game.winner === 1,
    game.winner + ' - ' + game.why);
check('it takes a plausible number of shots', game.shots > 2 && game.shots < 120,
    String(game.shots));
check('every shot is logged', game.log.length === game.shots, game.log.length + '/' + game.shots);
check('the log says what was hit and what dropped', game.log.every(function (s) {
    return typeof s.player === 'number' && Array.isArray(s.potted) && s.params;
}));

var again = Match.playGame([Bot.create({seed: 101}), Bot.create({seed: 202})], {seed: 42});
check('the same seeds play the same game',
    again.winner === game.winner && again.shots === game.shots &&
    JSON.stringify(again.log.map(function (s) { return s.potted; })) ===
    JSON.stringify(game.log.map(function (s) { return s.potted; })));

console.log('searching beats not searching');

/*
 * Measured over positions rather than games. Twelve racks is far too few to
 * separate two players - the sample swings by twenty points either way - but a
 * hundred shots from the same hundred layouts is not noisy at all, and it tests
 * the thing that actually differs: geometry says a pot is available, simulating
 * it says whether this speed will make it.
 */
function layouts(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
        var rand = Match.rng(4000 + i);
        var t = Phys.createTable({width: Match.TABLE_W, height: Match.TABLE_H});
        t.add(new Phys.Ball(0, 0.2 + rand() * 1.8, 0.15 + rand() * 0.82));
        for (var k = 1; k <= 4; k++) {
            t.add(new Phys.Ball(k, 0.2 + rand() * 1.8, 0.15 + rand() * 0.82));
        }
        Match.settle(t, Rules.newShot(t, [null, null], 0, false), 3);
        out.push(t);
    }
    return out;
}

function potRate(bot, tables) {
    var taken = 0, dropped = 0;
    tables.forEach(function (t, i) {
        var pos = {groups: ['solids', 'stripes'], player: 0, open: false, broken: true};
        var snap = Bot.snapshot(t);
        var legal = Rules.legalBalls(t, pos.groups, 0);
        if (!Geometry.candidates(t, legal).length) { Bot.restore(t, snap); return; }

        var params = bot.shoot(t, pos);
        taken++;
        var r = Match.playShot(t, pos, params);
        if (r.potted.length && !r.foul) dropped++;
        Bot.restore(t, snap);
        void i;
    });
    return {taken: taken, dropped: dropped};
}

var tables = layouts(90);
var plainRate = potRate(Bot.create({search: 0, seed: 77}), tables);
var searchRate = potRate(Bot.create({search: 4, seed: 77}), tables);

check('both bots take roughly the same shots on',
    plainRate.taken === searchRate.taken && plainRate.taken > 40,
    plainRate.taken + ' vs ' + searchRate.taken);
check('searching pots more of them',
    searchRate.dropped > plainRate.dropped,
    plainRate.dropped + ' -> ' + searchRate.dropped + ' of ' + plainRate.taken);
check('and it is a clear margin, not a rounding error',
    (searchRate.dropped - plainRate.dropped) / plainRate.taken > 0.05,
    ((searchRate.dropped - plainRate.dropped) / plainRate.taken * 100).toFixed(1) + ' points');

console.log('the table runs off its own clock');

// cannon's own sub stepping gives up early once it has spent longer than a step
// is worth, so a busy machine used to change the physics. phys.js sub steps
// itself now, and the same shot has to come out the same however slow the run.
function sameShotTwice(busy) {
    var t = Match.setup(Match.rng(55));
    t.ball(0).placeAt(0.5, 0.56);
    var p = {groups: [null, null], player: 0, open: true, broken: false};
    Match.playShot(t, p, {angle: 0.02, power: 8, side: 0, vert: 0, elevation: 0});
    if (busy) { for (var i = 0, x = 0; i < 3e6; i++) x += Math.sqrt(i); void x; }
    return layout(t);
}
check('a slow machine plays the same shot as a fast one',
    sameShotTwice(false) === sameShotTwice(true));

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
