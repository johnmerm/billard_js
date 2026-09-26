/**
 * Shot geometry tests: node test/geometry.test.js
 *
 * train/geometry.js is the part of aiming that is arithmetic rather than
 * judgement, and everything built on top of it inherits its mistakes: a sign
 * slip in the ghost ball silently returns no shots at all, which reads from the
 * outside like a table with nothing on. So the checks here are against the
 * physics rather than against the formula - set a shot up, play it, and see
 * whether the ball went in.
 */
var Phys = require('../phys.js');
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

function table() {
    return Phys.createTable({width: 2.24, height: 1.12});
}

function settle(w, limit) {
    var t = 0, events = [];
    while (!w.atRest() && t < (limit || 30)) {
        events = events.concat(w.step(1 / 120));
        t += 1 / 120;
    }
    return events;
}

function potted(events, id) {
    return events.some(function (e) { return e.type === 'pot' && e.ball.id === id; });
}

/* ------------------------------------------------------------------ */

console.log('the ghost ball');

var w = table();
var cue = w.add(new Phys.Ball(0, 0.4, 0.56));
var obj = w.add(new Phys.Ball(1, 1.1, 0.56));
var corner = w.pockets[2];            // far corner, at (W, 0)

var g = Geometry.ghost(w, cue, obj, corner);
check('there is a ghost ball for a reachable pot', !!g);
check('it sits one diameter back from the object ball', g &&
    Math.abs(Math.sqrt((g.x - obj.x) * (g.x - obj.x) + (g.y - obj.y) * (g.y - obj.y)) -
        2 * w.radius) < 1e-9);
check('it is on the far side of the ball from the pocket', g &&
    (g.x - obj.x) * (obj.x - corner.x) > 0);

// a pocket the cue ball is on the wrong side of has no pot in it
var behind = Geometry.ghost(w, cue, obj, {x: 0, y: 0.56, radius: 0.05});
check('a pocket behind the cue ball offers nothing', behind === null,
    JSON.stringify(behind));

console.log('a straight pot goes in');

/** Where a cue ball has to sit for a dead straight pot of `ball` into `pocket`. */
function behindTheLine(ball, pocket, back) {
    var dx = ball.x - pocket.x, dy = ball.y - pocket.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    return {x: ball.x + dx / len * back, y: ball.y + dy / len * back};
}

var straight = table();
var target = straight.add(new Phys.Ball(1, 0.6, 0.35));
var corner = straight.pockets[0];                      // (0, 0)
var from = behindTheLine(target, corner, 0.5);
straight.add(new Phys.Ball(0, from.x, from.y));

var sg = Geometry.ghost(straight, straight.ball(0), target, corner);
check('a ball lined up on the pocket is a straight shot',
    sg && sg.cut < 0.02, sg ? (sg.cut * 180 / Math.PI).toFixed(1) + ' deg' : 'no ghost');
straight.strike(straight.ball(0), Math.cos(sg.angle), Math.sin(sg.angle), 2.4, 0, 0, 0);
check('aiming at the ghost ball drops it', potted(settle(straight), 1));

console.log('the cut angle means what it says');

var cuts = table();
var onLine = cuts.add(new Phys.Ball(1, 0.6, 0.3));
var offLine = cuts.add(new Phys.Ball(2, 0.5, 0.42));
var mouth = cuts.pockets[0];
var seat = behindTheLine(onLine, mouth, 0.45);
cuts.add(new Phys.Ball(0, seat.x, seat.y));

var a = Geometry.ghost(cuts, cuts.ball(0), onLine, mouth);
var b = Geometry.ghost(cuts, cuts.ball(0), offLine, mouth);
check('a ball on the pocket line is the straighter shot', a && b && a.cut < b.cut,
    a && b ? (a.cut * 180 / Math.PI).toFixed(0) + ' vs ' + (b.cut * 180 / Math.PI).toFixed(0)
        : 'no ghost');
check('every cut it offers is under a right angle', a && b &&
    a.cut < Math.PI / 2 && b.cut < Math.PI / 2);

console.log('what is in the way');

var blocked = table();
blocked.add(new Phys.Ball(0, 0.4, 0.56));
blocked.add(new Phys.Ball(1, 1.4, 0.56));
blocked.add(new Phys.Ball(2, 0.9, 0.56));      // sitting between the two
check('a ball on the line blocks it',
    !Geometry.clear(blocked, 0.4, 0.56, 1.4, 0.56, [blocked.ball(0), blocked.ball(1)]));
check('a ball well off the line does not',
    Geometry.clear(blocked, 0.4, 0.2, 1.4, 0.2, [blocked.ball(0), blocked.ball(1)]));
check('a ball behind the shot does not',
    Geometry.clear(blocked, 1.0, 0.56, 1.4, 0.56, [blocked.ball(0), blocked.ball(1)]));

console.log('the shortlist');

var open = table();
open.add(new Phys.Ball(0, 0.5, 0.56));
var one = open.add(new Phys.Ball(1, 1.5, 0.3));
var list = Geometry.candidates(open, [one]);
check('one ball in the open offers several pockets', list.length >= 2, String(list.length));
check('the straightest comes first', list.every(function (c, i) {
    return i === 0 || c.cut >= list[i - 1].cut;
}));
check('every one names a ball and a pocket', list.every(function (c) {
    return c.ball === one && c.pocket && typeof c.angle === 'number';
}));

var snookered = table();
snookered.add(new Phys.Ball(0, 0.5, 0.56));
var hidden = snookered.add(new Phys.Ball(1, 1.5, 0.56));
for (var k = 2; k < 8; k++) {             // a wall of balls in front of it
    snookered.add(new Phys.Ball(k, 1.0, 0.36 + (k - 2) * 2.1 * snookered.radius));
}
check('a ball behind a wall offers nothing',
    Geometry.candidates(snookered, [hidden]).length === 0);

console.log('it pots what it says it can');

var tried = 0, dropped = 0;
for (var i = 0; i < 40; i++) {
    var t = table();
    t.add(new Phys.Ball(0, 0.3 + (i % 7) * 0.24, 0.2 + (i % 5) * 0.17));
    t.add(new Phys.Ball(1, 1.0 + (i % 5) * 0.2, 0.25 + (i % 6) * 0.12));
    settle(t, 2);

    var shots = Geometry.candidates(t, [t.ball(1)], 40 * Math.PI / 180);
    if (!shots.length) continue;
    tried++;
    t.strike(t.ball(0), Math.cos(shots[0].angle), Math.sin(shots[0].angle), 2.6, 0, 0, 0);
    if (potted(settle(t), 1)) dropped++;
}
check('most pots under a forty degree cut actually drop',
    tried >= 20 && dropped / tried > 0.8, dropped + ' of ' + tried);

/* ------------------------------------------------------------------ */

console.log('');
console.log('off a cushion');

// The mirror itself is arithmetic and worth pinning exactly: everything the
// bank and kick shots do rests on it being right.
var m = Geometry.mirror({x: 1, y: 2}, {x1: 0, y1: 0, x2: 5, y2: 0});
check('a point reflects in a horizontal cushion', m.x === 1 && m.y === -2, JSON.stringify(m));
var m2 = Geometry.mirror({x: 1, y: 2}, {x1: 3, y1: -5, x2: 3, y2: 5});
check('and in a vertical one', m2.x === 5 && m2.y === 2, JSON.stringify(m2));

check('a crossing on the cushion is found',
    !!Geometry.meets(1, 1, 1, -1, {x1: 0, y1: 0, x2: 5, y2: 0}));
check('a crossing past its end is not',
    Geometry.meets(9, 1, 9, -1, {x1: 0, y1: 0, x2: 5, y2: 0}) === null);

// And then the standard the rest of this file holds itself to: set the shot
// up, play it, and see whether the ball went in. A cushion has a restitution
// under one and takes speed out of the ball, so the mirror gives the aim and
// not the outcome - this is what says whether the aim is good enough to be
// worth simulating at all.
var tried = 0, dropped = 0;
for (var trial = 0; trial < 12; trial++) {
    var bx = 0.6 + (trial % 4) * 0.35, by = 0.30 + Math.floor(trial / 4) * 0.26;

    var look = table();
    var lc = new Phys.Ball(0, 0, 0), lb = new Phys.Ball(8, 0, 0);
    look.add(lc); look.add(lb);
    lc.placeAt(0.35, 0.56); lb.placeAt(bx, by);

    var banks = Geometry.cushionShots(look, [lb], 'bank');
    if (!banks.length) continue;

    [4, 6, 8].forEach(function (power) {
        var w = table();
        var cue = new Phys.Ball(0, 0, 0), ball = new Phys.Ball(8, 0, 0);
        w.add(cue); w.add(ball);
        cue.placeAt(0.35, 0.56); ball.placeAt(bx, by);
        w.strike(cue, Math.cos(banks[0].angle), Math.sin(banks[0].angle), power, 0, 0, 0);
        tried++;
        if (potted(settle(w), 8)) dropped++;
    });
}
check('the shortlist offers banks at all', tried > 0, tried + ' played');
// It measured 16 of 36 when written. A quarter is well clear of that and well
// clear of nothing, which is the distinction this is here to catch.
check('and a mirrored bank drops often enough to be worth simulating',
    dropped * 4 >= tried, dropped + ' of ' + tried + ' dropped');

// A kick aims the cue ball at a cushion rather than at the ball, so its first
// leg must point somewhere other than straight at the object ball.
var kw = table();
var kc = new Phys.Ball(0, 0, 0), kb = new Phys.Ball(8, 0, 0);
kw.add(kc); kw.add(kb);
kc.placeAt(0.4, 0.56); kb.placeAt(1.6, 0.56);
var kicks = Geometry.cushionShots(kw, [kb], 'kick');
check('kicks are offered too', kicks.length > 0, kicks.length + ' found');
if (kicks.length) {
    var straight = Math.atan2(0, 1.2);
    check('and none of them is the straight shot',
        kicks.every(function (k) { return Math.abs(k.angle - straight) > 0.02; }));
    check('each one names where it meets the cushion',
        kicks.every(function (k) { return k.via && isFinite(k.via.x) && isFinite(k.via.y); }));
}

/* ------------------------------------------------------------------ */

console.log('');
console.log('what the shortlist offers on the black');

var sw = table();
var sc = new Phys.Ball(0, 0, 0), sb = new Phys.Ball(8, 0, 0);
sw.add(sc); sw.add(sb);
sc.placeAt(0.5, 0.56); sb.placeAt(1.5, 0.56);

var plain = Geometry.shortlist(sw, [sb], {onEight: true, cushion: false});
check('with the rule off it is the direct pots', plain.length > 0 &&
    plain.every(function (c) { return c.kind === 'direct'; }),
    plain.length + ' found');

var house = Geometry.shortlist(sw, [sb], {onEight: true, cushion: true});
var kinds = {};
house.forEach(function (c) { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
check('with it on there are no direct pots left', !kinds.direct, JSON.stringify(kinds));
// Either cushion finishes a game under this rule, so a player must be shown
// both: offering one kind was the bug that left the bot with no legal shot.
check('and both kinds are on the list', kinds.bank > 0 && kinds.kick > 0,
    JSON.stringify(kinds));
check('straightest first, across both kinds', house.every(function (c, i) {
    return i === 0 || c.cut >= house[i - 1].cut;
}));

// The rule is about the black and nothing else, so an ordinary ball is still
// shot at directly however the house plays the endgame.
var ob = sw.add(new Phys.Ball(3, 1.2, 0.3));
var ordinary = Geometry.shortlist(sw, [ob], {onEight: false, cushion: true});
check('it says nothing about any other ball', ordinary.length > 0 &&
    ordinary.every(function (c) { return c.kind === 'direct'; }),
    ordinary.length + ' found');

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
