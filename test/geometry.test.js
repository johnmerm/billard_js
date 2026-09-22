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
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
