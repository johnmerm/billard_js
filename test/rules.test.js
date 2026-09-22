/**
 * Eight ball rules tests: node test/rules.test.js
 *
 * rules.js is the one rulebook the page and any headless match both play by, so
 * a mistake here is a mistake in two places at once, and a self play trainer
 * would happily learn to exploit it. `resolve` is a function - it reads the
 * table and the shot and returns what happened - so every case below is one
 * call with no setup beyond the balls left on the cloth.
 */
var Phys = require('../phys.js');
var Rules = require('../rules.js');

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
 * A table holding exactly `ids`, spread out so nothing is touching. Balls that
 * went down in the shot being judged are simply not on it, which is the state
 * the physics leaves behind.
 */
function table(ids) {
    var w = Phys.createTable({width: 2.24, height: 1.12});
    ids.forEach(function (id, i) {
        w.add(new Phys.Ball(id, 0.3 + (i % 6) * 0.3, 0.25 + Math.floor(i / 6) * 0.3));
    });
    return w;
}

/** A finished shot, described the way the physics would have left it. */
function shot(opts) {
    return {
        first: opts.first === undefined ? 1 : opts.first,
        potted: opts.potted || [],
        rail: opts.rail === undefined ? true : opts.rail,
        breakShot: !!opts.breakShot,
        target: opts.target === undefined ? null : opts.target
    };
}

function at(opts) {
    return {
        groups: opts.groups || [null, null],
        player: opts.player || 0,
        open: opts.open === undefined ? true : opts.open
    };
}

/* ------------------------------------------------------------------ */

console.log('who has to hit what');

var open = table([0, 1, 2, 9, 10, 8]);
check('an open table names no target',
    Rules.legalTarget(open, [null, null], 0) === null);
check('an open table lets you hit anything but the 8',
    Rules.legalBalls(open, [null, null], 0).map(function (b) { return b.id; })
        .join() === '1,2,9,10');

check('a player on solids is on solids',
    Rules.legalTarget(open, ['solids', 'stripes'], 0) === 'solids');
check('and may only hit solids',
    Rules.legalBalls(open, ['solids', 'stripes'], 0).map(function (b) { return b.id; })
        .join() === '1,2');

var cleared = table([0, 9, 10, 8]);
check('a player with nothing left is on the 8',
    Rules.legalTarget(cleared, ['solids', 'stripes'], 0) === 'eight');
check('and may only hit the 8',
    Rules.legalBalls(cleared, ['solids', 'stripes'], 0).map(function (b) { return b.id; })
        .join() === '8');

console.log('fouls');

var t = table([0, 1, 9, 8]);
check('missing everything is a foul',
    Rules.resolve(t, at({}), shot({first: null})).foul === 'No contact with any ball.');

check('hitting the wrong half is a foul',
    /Wrong ball first/.test(
        Rules.resolve(t, at({groups: ['solids', 'stripes'], open: false}),
            shot({first: 9, target: 'solids'})).foul || ''));

check('the 8 is never a legal first hit on an open table',
    /never a legal first hit/.test(
        Rules.resolve(t, at({}), shot({first: 8})).foul || ''));

check('but it is on the break', Rules.resolve(t, at({}),
    shot({first: 8, breakShot: true})).foul === null);

check('nothing potted and no cushion is a foul',
    /nothing reached a cushion/.test(
        Rules.resolve(t, at({}), shot({first: 1, rail: false})).foul || ''));

check('a cushion after contact saves it',
    Rules.resolve(t, at({}), shot({first: 1, rail: true})).foul === null);

check('potting the cue ball is a foul',
    /Scratch/.test(Rules.resolve(table([0, 9, 8]), at({}),
        shot({first: 1, potted: [0, 1]})).foul || ''));

var foul = Rules.resolve(t, at({player: 0}), shot({first: null}));
check('a foul hands over the table', foul.player === 1 && foul.ballInHand === true);
check('and only the break keeps the incoming player behind the line',
    foul.kitchenOnly === false &&
    Rules.resolve(t, at({player: 0}), shot({first: null, breakShot: true})).kitchenOnly === true);

console.log('who shoots next');

var potted = Rules.resolve(table([0, 2, 9, 8]),
    at({groups: ['solids', 'stripes'], open: false}),
    shot({first: 1, potted: [1], target: 'solids'}));
check('potting your own ball keeps you at the table', potted.player === 0);
check('and says so', /Same player again/.test(potted.message));

var theirs = Rules.resolve(table([0, 1, 2, 8]),
    at({groups: ['solids', 'stripes'], open: false}),
    shot({first: 1, potted: [9], target: 'solids'}));
check('potting only their ball passes the turn', theirs.player === 1);

var nothing = Rules.resolve(t, at({player: 1}), shot({first: 1}));
check('potting nothing passes the turn', nothing.player === 0);

console.log('the table closing');

var closing = Rules.resolve(table([0, 2, 9, 10, 8]), at({player: 0, open: true}),
    shot({first: 1, potted: [1]}));
check('the first pot after the break decides the halves',
    closing.groups && closing.groups[0] === 'solids' && closing.groups[1] === 'stripes',
    JSON.stringify(closing.groups));
check('and closes the table', closing.open === false);
check('the player stays at the table, on the half they just took',
    closing.player === 0);

var onBreak = Rules.resolve(table([0, 2, 9, 8]), at({player: 0, open: true}),
    shot({first: 1, potted: [1], breakShot: true}));
check('a pot on the break decides nothing', onBreak.groups === null && onBreak.open === true);

// scratching, not hitting the wrong ball: on an open table there is no wrong
// ball to hit, so a scratch is the way to foul and pot in the same shot
var fouled = Rules.resolve(table([0, 2, 9, 8]), at({player: 0, open: true}),
    shot({first: 1, potted: [1, 0], target: null}));
check('a pot on a foul decides nothing either',
    fouled.foul && fouled.groups === null, JSON.stringify(fouled.groups));

console.log('the eight ball');

var onTheBreak = Rules.resolve(table([0, 1, 9]), at({}),
    shot({first: 1, potted: [8], breakShot: true}));
check('the 8 on the break is spotted, not a loss',
    onTheBreak.respotEight === true && onTheBreak.gameOver === null);

var win = Rules.resolve(table([0, 9, 10]),          // no solids left on the cloth
    at({groups: ['solids', 'stripes'], player: 0, open: false}),
    shot({first: 8, potted: [8], target: 'eight'}));
check('the 8 after clearing your half wins it',
    win.gameOver && win.gameOver.winner === 0, JSON.stringify(win.gameOver));

var early = Rules.resolve(table([0, 1, 9]),         // a solid still on the cloth
    at({groups: ['solids', 'stripes'], player: 0, open: false}),
    shot({first: 1, potted: [8], target: 'solids'}));
check('the 8 before that loses it',
    early.gameOver && early.gameOver.winner === 1, JSON.stringify(early.gameOver));

var scratched = Rules.resolve(table([0, 9, 10]),
    at({groups: ['solids', 'stripes'], player: 0, open: false}),
    shot({first: 8, potted: [8, 0], target: 'eight'}));
check('the 8 and the cue ball together loses it',
    scratched.gameOver && scratched.gameOver.winner === 1);

var wrongFirst = Rules.resolve(table([0, 9, 10]),
    at({groups: ['solids', 'stripes'], player: 0, open: false}),
    shot({first: 9, potted: [8], target: 'eight'}));
check('so does potting it off the wrong ball',
    wrongFirst.gameOver && wrongFirst.gameOver.winner === 1);

console.log('it decides, it does not act');

var before = table([0, 1, 9, 8]);
var snapshot = before.balls.map(function (b) {
    return b.id + ':' + b.active + ':' + b.x.toFixed(6) + ',' + b.y.toFixed(6);
}).join('|');
var pos = at({groups: ['solids', 'stripes'], player: 0, open: false});
var posCopy = JSON.stringify(pos);
Rules.resolve(before, pos, shot({first: 1, potted: [1], target: 'solids'}));

check('the table is left exactly as it was', before.balls.map(function (b) {
    return b.id + ':' + b.active + ':' + b.x.toFixed(6) + ',' + b.y.toFixed(6);
}).join('|') === snapshot);
check('and so is the position it was given', JSON.stringify(pos) === posCopy);

console.log('spotting');

var crowded = table([0, 8]);
crowded.ball(0).placeAt(2.24 * 0.75, 1.12 / 2);      // sitting on the foot spot
Rules.respot(crowded, crowded.ball(8));
check('a spotted ball goes behind anything already there',
    Math.hypot(crowded.ball(8).x - crowded.ball(0).x,
        crowded.ball(8).y - crowded.ball(0).y) > 2.05 * crowded.radius,
    crowded.ball(8).x.toFixed(3) + ',' + crowded.ball(8).y.toFixed(3));

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
