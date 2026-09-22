/**
 * train/bot.js - the player a learned one has to beat.
 *
 * It plays the way someone does after an afternoon in a pub: take the
 * straightest pot on the table, hit it hard enough to reach the pocket, and if
 * there is nothing on, roll up behind something and hope. No position play at
 * all - it never asks where the cue ball will finish - which is exactly the gap
 * a value function is meant to fill, and why this is the baseline rather than
 * the goal.
 *
 * Two settings worth knowing:
 *
 *   search   simulate this many of the shortlisted pots and keep one that
 *            actually drops. Geometry says a 60 degree cut goes in about two
 *            thirds of the time; simulating four of them and taking a winner
 *            turns that into near certainty, at four shots' worth of time.
 *   noise    jitter the aim, in radians. Zero plays the same rack the same way
 *            forever, which is useless as training data.
 */
var Rules = require('../rules.js');
var Geometry = require('./geometry.js');
var Match = require('./match.js');

/**
 * Enough of the table to undo a trial shot.
 *
 * Positions are the easy half: `placeAt` stops the ball and puts a potted one
 * back on the cloth by itself, and a uniform sphere's orientation changes
 * nothing about what it does next.
 *
 * The other half is the order the bodies sit in. Potting one takes it out of
 * the physics world and putting it back appends it, and the solver works
 * through its equations in that order, so a table restored in a different order
 * is not the same table: the next shot comes out a little differently, and by
 * the end of the rack it is a different game. The order goes back too.
 */
function snapshot(world) {
    return {
        balls: world.balls.map(function (b) {
            return {ball: b, active: b.active, x: b.x, y: b.y};
        }),
        bodies: world.cannon.bodies.slice(),
        carry: world.carry
    };
}

function restore(world, snap) {
    snap.balls.forEach(function (s) {
        if (s.active) s.ball.placeAt(s.x, s.y);
        else if (s.ball.active) s.ball.lift();
    });

    var bodies = world.cannon.bodies;
    bodies.length = 0;
    for (var i = 0; i < snap.bodies.length; i++) {
        bodies.push(snap.bodies[i]);
        snap.bodies[i].index = i;
    }

    world.carry = snap.carry;      // the leftover of the last part step
}

/**
 * How hard to hit a pot: enough to carry the object ball to the pocket with
 * something to spare, and more for a thin cut, which bleeds speed sideways.
 */
function power(candidate) {
    var reach = candidate.distance + candidate.toPocket;
    var thin = 1 + 1.6 * (1 - Math.cos(candidate.cut));
    return Math.max(1.6, Math.min(6.5, 1.3 + 1.5 * reach * thin));
}

/**
 * Nothing is on. Roll the cue ball gently at a legal ball so that something
 * reaches a cushion - the alternative is a foul for nothing moving.
 */
function safety(world, pos, rand) {
    var legal = Rules.legalBalls(world, pos.groups, pos.player);
    var cue = world.ball(0);
    if (!legal.length) return null;

    // the one it can actually see, if any
    var seen = null;
    for (var i = 0; i < legal.length && !seen; i++) {
        var hit = world.firstContact(cue.x, cue.y,
            legal[i].x - cue.x, legal[i].y - cue.y, cue);
        if (hit && hit.type === 'ball' && hit.ball === legal[i]) seen = legal[i];
    }
    var aim = seen || legal[0];

    return {
        angle: Math.atan2(aim.y - cue.y, aim.x - cue.x) + (rand() - 0.5) * 0.02,
        power: 2.2 + rand() * 0.8,      // enough to reach a rail and come back
        side: 0, vert: 0, elevation: 0
    };
}

/**
 * The break: hit the apex ball squarely, hard.
 */
function breakShot(world, rand) {
    var cue = world.ball(0);
    var apex = world.balls.filter(function (b) { return b.active && b.id !== 0; })
        .sort(function (a, b) { return a.x - b.x; })[0];
    if (!apex) return null;
    return {
        angle: Math.atan2(apex.y - cue.y, apex.x - cue.x) + (rand() - 0.5) * 0.03,
        power: 8.2, side: 0, vert: 0, elevation: 0
    };
}

/**
 * Where to put the cue ball down. It tries a grid of spots and keeps the one
 * that leaves the most pots on, which is about as far as you can get without
 * thinking about what happens after them.
 */
function place(world, pos, rand, kitchenOnly) {
    var W = Match.TABLE_W, H = Match.TABLE_H;
    var legal = Rules.legalBalls(world, pos.groups, pos.player);
    var best = null, bestScore = -1;

    // Trying a spot means putting the cue ball on it, which brings it back onto
    // the table - and it is meant to be in hand. So the whole scan is bracketed
    // by a snapshot: look at the position without being part of it.
    var snap = snapshot(world);

    var maxX = kitchenOnly ? W * 0.25 : W;
    for (var i = 1; i <= 10; i++) {
        for (var j = 1; j <= 6; j++) {
            var x = maxX * i / 11, y = H * j / 7;
            if (!Rules.placementLegal(world, x, y, kitchenOnly)) continue;

            world.ball(0).placeAt(x, y);
            var shots = Geometry.candidates(world, legal);

            // the straightest pot available matters more than how many there are
            var score = shots.length
                ? 10 * Math.cos(shots[0].cut) + shots.length + rand() * 0.5
                : rand() * 0.5;
            if (score > bestScore) { bestScore = score; best = {x: x, y: y}; }
        }
    }
    restore(world, snap);
    return best || {x: W * 0.22, y: H / 2};
}

/**
 * @param {Object} [opts] {search, noise, seed}
 */
function create(opts) {
    opts = opts || {};
    var rand = Match.rng(opts.seed || 12345);
    var trials = opts.search === undefined ? 0 : opts.search;
    var noise = opts.noise === undefined ? 0.004 : opts.noise;

    function shoot(world, pos) {
        if (!pos.broken) return breakShot(world, rand);

        var legal = Rules.legalBalls(world, pos.groups, pos.player);
        var shortlist = Geometry.candidates(world, legal);
        if (!shortlist.length) return safety(world, pos, rand);

        var pick = function (c) {
            return {
                angle: c.angle + (rand() - 0.5) * noise,
                power: power(c), side: 0, vert: 0, elevation: 0
            };
        };

        if (!trials) return pick(shortlist[0]);

        // Try the shortlist for real and keep the first that drops. Geometry
        // only says a pot is available, not that this speed will make it.
        var snap = snapshot(world);
        var fallback = null;
        for (var i = 0; i < Math.min(trials, shortlist.length); i++) {
            var params = pick(shortlist[i]);
            var trial = Match.playShot(world, {
                groups: pos.groups, player: pos.player, open: pos.open,
                broken: pos.broken
            }, params);
            var dropped = trial.potted.indexOf(shortlist[i].ball.id) >= 0;
            var clean = !trial.foul;
            restore(world, snap);

            if (dropped && clean) return params;
            if (!fallback && clean) fallback = params;
        }
        return fallback || pick(shortlist[0]);
    }

    return {
        name: opts.name || (trials ? 'search' + trials : 'greedy'),
        place: function (world, pos) {
            return place(world, pos, rand, pos.kitchenOnly);
        },
        shoot: shoot
    };
}

module.exports = {create: create, power: power, place: place, snapshot: snapshot,
    restore: restore};
