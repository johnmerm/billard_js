/**
 * The written table: node test/brief.test.js
 *
 * A brief is read by something that cannot see the cloth, so every claim it
 * makes has to be true of the position and not merely plausible. The tables
 * below are built ball by ball at known coordinates rather than racked and
 * played, so each check knows exactly what the right answer is.
 *
 * Two things matter most. The pot list has to be complete and in order, since a
 * reader picks from it by number and cannot pick what is not there. And the
 * rejections have to name the real obstruction: "10 guards the pocket" is the
 * difference between playing safe and firing at a ball that cannot drop.
 */
var Phys = require('../phys.js');
var Match = require('../train/match.js');
var Brief = require('../brief.js');

var failures = 0;

function check(name, ok, detail) {
    if (ok) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? ' -> ' + detail : ''));
    }
}

/**
 * A table holding exactly the balls named, in metres.
 * @param {Object} at  {id: [x, y]} in cm
 */
function table(at) {
    var world = Phys.createTable({width: Match.TABLE_W, height: Match.TABLE_H});
    Object.keys(at).forEach(function (id) {
        var ball = new Phys.Ball(Number(id), 0, 0);
        world.add(ball);
        ball.placeAt(at[id][0] / 100, at[id][1] / 100);
    });
    return world;
}

function position(over) {
    var pos = {groups: [null, null], player: 0, open: true, broken: true,
        ballInHand: false, kitchenOnly: false};
    Object.keys(over || {}).forEach(function (k) { pos[k] = over[k]; });
    return pos;
}

/** The pot list, one entry per line, without the surrounding prose. */
function potLines(text) {
    var out = [], on = false;
    text.split('\n').forEach(function (line) {
        if (/^Your pots/.test(line)) { on = true; return; }
        if (on && /^ {2}\[/.test(line)) out.push(line.trim());
        else if (on) on = false;
    });
    return out;
}

function notOn(text) {
    var line = text.split('\n').filter(function (l) { return /^Not on:/.test(l); })[0];
    return line || '';
}

/* ------------------------------------------------------------------ */

console.log('the pot list');

// The 1 sits straight in front of the side pocket with the cue ball square
// behind it: the one shot on this table, and a dead straight one.
var straight = table({0: [112, 60], 1: [112, 15], 10: [20, 100]});
var text = Brief.describe(straight, position({
    groups: ['solids', 'stripes'], open: false
}));

check('a straight pot leads the list',
    /^\[1\] 1\s+into \(112,0\)\s+cut 0deg/.test(potLines(text)[0]),
    potLines(text)[0]);

check('the cue ball position is reported where it stands',
    /\n {2}cue\s+112,60\n/.test(text), text);

check('a pocket the cue ball cannot reach round to is left out of Not on',
    notOn(text).indexOf('wrong side') < 0, notOn(text));

check('every pot offered names a ball the player is allowed to hit',
    potLines(text).every(function (l) { return /^\[\d+\] 1\s/.test(l); }),
    potLines(text).join(' | '));

/* ------------------------------------------------------------------ */

console.log('');
console.log('what is in the way');

// Same pot, with a stripe parked on the line the cue ball has to travel.
var guarded = table({0: [112, 60], 1: [112, 15], 10: [112, 40]});
var guardedText = Brief.describe(guarded, position({
    groups: ['solids', 'stripes'], open: false
}));

check('a ball on the cue ball path is named as the blocker',
    /1 into \(112,0\) - 10 blocks the cue ball/.test(notOn(guardedText)),
    notOn(guardedText));

check('the blocked pot is not also offered as a shot',
    potLines(guardedText).every(function (l) { return l.indexOf('(112,0)') < 0; }),
    potLines(guardedText).join(' | '));

// And with the stripe between the object ball and the pocket instead.
var mouth = table({0: [112, 60], 1: [112, 30], 10: [112, 12]});
var mouthText = Brief.describe(mouth, position({
    groups: ['solids', 'stripes'], open: false
}));

check('a ball in front of the pocket is named as guarding it',
    /1 into \(112,0\) - 10 guards the pocket/.test(notOn(mouthText)),
    notOn(mouthText));

// The nearest obstruction is the one that actually gets hit, so it is the one
// worth naming when two balls sit on the same line.
var twoDeep = table({0: [112, 90], 1: [112, 15], 10: [112, 40], 12: [112, 65]});
check('of two balls on the line, the nearer one is named',
    /1 into \(112,0\) - 12 blocks the cue ball/.test(
        notOn(Brief.describe(twoDeep, position({
            groups: ['solids', 'stripes'], open: false
        })))),
    notOn(Brief.describe(twoDeep, position({
        groups: ['solids', 'stripes'], open: false
    }))));

/* ------------------------------------------------------------------ */

console.log('');
console.log('whose turn it is and what they are on');

var onEight = table({0: [112, 60], 8: [112, 15], 10: [20, 100], 11: [30, 100]});
var eightText = Brief.describe(onEight, position({
    groups: ['solids', 'stripes'], open: false
}));

check('a player with nothing left is told the 8 wins it',
    /the 8 wins it/.test(eightText), eightText.split('\n')[1]);

check('and is offered the 8 as a pot',
    /^\[1\] 8\s+into \(112,0\)/.test(potLines(eightText)[0]),
    potLines(eightText)[0]);

// The same table read from the other chair: the opponent is on the 8, which is
// worth saying out loud rather than reporting as a count of zero.
var threatened = Brief.describe(onEight, position({
    groups: ['solids', 'stripes'], open: false, player: 1
}));
check('an opponent on the 8 is called that, not "0 left"',
    /Opponent is SOLIDS, all down and on the 8\./.test(threatened),
    threatened.split('\n')[2]);

check('and their potted balls read as all down',
    /\n {2}theirs\s+all down\n/.test(threatened), threatened);

/* ------------------------------------------------------------------ */

console.log('');
console.log('the open table');

var open = table({0: [112, 60], 1: [112, 15], 9: [60, 40], 8: [180, 80]});
var openText = Brief.describe(open, position());

check('an open table says so',
    /The table is open/.test(openText), openText.split('\n')[1]);

check('and lists the two halves of the rack apart',
    /\n {2}solids\s+1: 112,15\n {2}stripes\s+9: 60,40\n/.test(openText), openText);

check('the 8 is not offered while the table is open',
    potLines(openText).every(function (l) { return !/^\[\d+\] 8\s/.test(l); }),
    potLines(openText).join(' | '));

/* ------------------------------------------------------------------ */

console.log('');
console.log('ball in hand');

var hand = table({0: [112, 60], 1: [112, 15], 10: [20, 100]});
hand.ball(0).lift();
var handText = Brief.describe(hand, position({
    groups: ['solids', 'stripes'], open: false, ballInHand: true
}));

check('a player holding the cue ball is told to place it first',
    /Cue ball in hand/.test(handText), handText);

check('and is offered no pots, since there is no cue ball to shoot from',
    potLines(handText).length === 0, potLines(handText).join(' | '));

check('a free placement does not mention the head string',
    handText.indexOf('head string') < 0, handText);

var kitchen = Brief.describe(hand, position({
    groups: ['solids', 'stripes'], open: false,
    ballInHand: true, kitchenOnly: true
}));
check('a restricted placement gives the line to stay behind',
    /behind the head string: x at most 56\./.test(kitchen), kitchen);

/* ------------------------------------------------------------------ */

console.log('');
console.log('nothing on');

// Snookered: the only solid is behind a stripe, with no pocket reachable.
var stuck = table({0: [112, 106], 1: [112, 56], 10: [112, 80]});
var stuckText = Brief.describe(stuck, position({
    groups: ['solids', 'stripes'], open: false
}));

check('a player with no pot is told to play safe',
    /No pot is on\. Play safe/.test(stuckText), stuckText);

check('and still hears what is in the way',
    /10 blocks the cue ball/.test(notOn(stuckText)), notOn(stuckText));

/* ------------------------------------------------------------------ */

console.log('');
console.log('cost');

var full = Brief.describe(Match.setup(Match.rng(3)), position({ballInHand: true}));
check('a brief stays inside a paragraph or two',
    full.split('\n').length < 20, full.split('\n').length + ' lines');

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
