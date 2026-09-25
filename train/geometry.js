/**
 * train/geometry.js - the shot a player can see without thinking about it.
 *
 * Potting a ball is geometry, not learning: to send ball B into pocket P the
 * cue ball has to arrive along the line from P through B, so its centre at the
 * moment of contact - the ghost ball - sits one ball diameter back from B along
 * that line. Aim at the ghost ball centre and, for a stun shot with no side, the
 * object ball leaves down the line of centres into the pocket.
 *
 * That is the seed. What it cannot tell you is how hard to hit it, what spin to
 * use, or where the cue ball ends up afterwards - and that is what the learning
 * is for. This module's job is to hand the search a short list of shots worth
 * simulating, instead of the whole circle of directions.
 */
var Geometry = (function () {
    'use strict';

    /**
     * Where the cue ball's centre must be at contact to send `ball` at `pocket`.
     * @return {?Object} {x, y, cut} - cut is the angle between the cue ball's
     *     path and the object ball's, 0 for a straight shot; null if the pot
     *     needs the cue ball to be somewhere it cannot get to.
     */
    function ghost(world, cue, ball, pocket) {
        var r = world.radius;

        // from the pocket back through the ball
        var px = ball.x - pocket.x, py = ball.y - pocket.y;
        var pl = Math.sqrt(px * px + py * py);
        if (pl < 1e-6) return null;
        px /= pl; py /= pl;

        var gx = ball.x + px * 2 * r, gy = ball.y + py * 2 * r;

        // the cue ball has to come at the ghost from somewhere in front of it
        var cx = gx - cue.x, cy = gy - cue.y;
        var cl = Math.sqrt(cx * cx + cy * cy);
        if (cl < 1e-6) return null;
        cx /= cl; cy /= cl;

        // The object ball leaves along -p, from itself towards the pocket. The
        // cue ball has to be pushing it that way, so its own direction needs a
        // positive component along -p; at ninety degrees or beyond there is no
        // contact that sends the ball anywhere near the pocket.
        var dot = cx * -px + cy * -py;
        if (dot <= 0) return null;
        var cut = Math.acos(Math.max(-1, Math.min(1, dot)));

        return {x: gx, y: gy, cut: cut, angle: Math.atan2(cy, cx), distance: cl,
            toPocket: pl};
    }

    /**
     * The ball in the way of the path from (x, y) to (tx, ty), if there is one.
     * A ball only has to pass within one diameter of another to clip it.
     *
     * Of several, the nearest to the start: that is the one that actually gets
     * hit, and the one worth naming when explaining why a pot is not on.
     *
     * @return {?Object} the obstructing ball, or null if the path is clear
     */
    function blocker(world, x, y, tx, ty, ignore) {
        var dx = tx - x, dy = ty - y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-6) return null;
        dx /= len; dy /= len;

        var r2 = (2 * world.radius) * (2 * world.radius);
        var hit = null, nearest = Infinity;
        for (var i = 0; i < world.balls.length; i++) {
            var b = world.balls[i];
            if (!b.active || ignore.indexOf(b) >= 0) continue;

            var ox = b.x - x, oy = b.y - y;
            var proj = ox * dx + oy * dy;
            if (proj <= 0 || proj >= len) continue;      // behind, or past the end
            if (ox * ox + oy * oy - proj * proj < r2 && proj < nearest) {
                nearest = proj;
                hit = b;
            }
        }
        return hit;
    }

    /** Is the path from (x, y) to (tx, ty) clear of every ball but `ignore`? */
    function clear(world, x, y, tx, ty, ignore) {
        return blocker(world, x, y, tx, ty, ignore) === null;
    }

    /**
     * Every pot on the table worth simulating, best cut angle first.
     *
     * A candidate survives only if the cue ball can reach the ghost without
     * clipping something on the way, the object ball has a clear run at the
     * pocket, and the cut is not so thin that no amount of power would carry it.
     *
     * @param {Object} world   the table
     * @param {Array} legal    the balls this player is allowed to hit first
     * @return {Array} {ball, pocket, angle, cut, distance, toPocket}
     */
    function candidates(world, legal, maxCut) {
        var cue = world.ball(0);
        var out = [];
        var limit = maxCut === undefined ? 75 * Math.PI / 180 : maxCut;

        legal.forEach(function (ball) {
            if (!ball.active || ball === cue) return;

            world.pockets.forEach(function (pocket, pi) {
                var g = ghost(world, cue, ball, pocket);
                if (!g || g.cut > limit) return;
                if (!clear(world, cue.x, cue.y, g.x, g.y, [cue, ball])) return;
                if (!clear(world, ball.x, ball.y, pocket.x, pocket.y, [cue, ball])) return;

                out.push({
                    ball: ball, pocket: pocket, pocketIndex: pi,
                    angle: g.angle, cut: g.cut,
                    distance: g.distance, toPocket: g.toPocket
                });
            });
        });

        // the straightest pot is the one a player looks at first
        out.sort(function (a, b) { return a.cut - b.cut; });
        return out;
    }

    /* ------------------------------------------------------------------ *
     * off a cushion
     *
     * A bank is the same shot as a direct pot, aimed at the pocket's
     * reflection: send the ball at where the pocket would be if the cushion
     * were a mirror and it arrives at the real one. Same for a kick, with the
     * cue ball mirrored instead, which is the shot the house rules on the
     * black ask for and the direct shortlist cannot describe at all.
     *
     * The mirror is where the aim comes from, not where it ends: a cushion has
     * a restitution under one and takes speed out of the ball, so the rebound
     * is not the perfect reflection the geometry assumes. These are candidates
     * to simulate, like the direct ones, and the simulator has the last word.
     * ------------------------------------------------------------------ */

    /** A point reflected in the infinite line a cushion segment lies on. */
    function mirror(p, c) {
        var ex = c.x2 - c.x1, ey = c.y2 - c.y1;
        var len2 = ex * ex + ey * ey;
        if (len2 < 1e-12) return null;

        var t = ((p.x - c.x1) * ex + (p.y - c.y1) * ey) / len2;
        var fx = c.x1 + ex * t, fy = c.y1 + ey * t;
        return {x: 2 * fx - p.x, y: 2 * fy - p.y};
    }

    /**
     * Where a->b crosses cushion `c`, if it does so on the cushion itself and
     * between the two ends. A crossing on the extension of either is a mirror
     * that reflects nothing.
     */
    function meets(ax, ay, bx, by, c) {
        var rx = bx - ax, ry = by - ay;
        var sx = c.x2 - c.x1, sy = c.y2 - c.y1;
        var denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-12) return null;          // parallel

        var t = ((c.x1 - ax) * sy - (c.y1 - ay) * sx) / denom;
        var u = ((c.x1 - ax) * ry - (c.y1 - ay) * rx) / denom;
        if (t <= 1e-6 || t >= 1 - 1e-6) return null;
        if (u <= 1e-6 || u >= 1 - 1e-6) return null;
        return {x: ax + rx * t, y: ay + ry * t};
    }

    /**
     * Pots that need a cushion, one reflection deep.
     *
     * @param {string} kind  'bank' sends the object ball off a cushion into
     *     the pocket; 'kick' sends the cue ball off one before it arrives.
     * @return {Array} the same shape the direct candidates have, plus `via`,
     *     the point on the cushion, and `kind`.
     */
    function cushionShots(world, legal, kind, maxCut) {
        var cue = world.ball(0);
        var limit = maxCut === undefined ? 75 * Math.PI / 180 : maxCut;
        var out = [];

        legal.forEach(function (ball) {
            if (!ball.active || ball === cue) return;

            world.pockets.forEach(function (pocket, pi) {
                world.cushions.forEach(function (c) {
                    // The little 45s across the pocket mouths are jaws, not a
                    // cushion anybody banks off on purpose.
                    if (c.jaw) return;

                    var g, via;
                    if (kind === 'bank') {
                        var aim = mirror(pocket, c);
                        if (!aim) return;
                        g = ghost(world, cue, ball, aim);
                        if (!g) return;
                        via = meets(ball.x, ball.y, aim.x, aim.y, c);
                        if (!via) return;
                        if (!clear(world, cue.x, cue.y, g.x, g.y, [cue, ball])) return;
                        if (!clear(world, ball.x, ball.y, via.x, via.y, [cue, ball])) return;
                        if (!clear(world, via.x, via.y, pocket.x, pocket.y, [cue, ball])) return;
                    } else {
                        var from = mirror(cue, c);
                        if (!from) return;
                        g = ghost(world, from, ball, pocket);
                        if (!g) return;
                        // The straight line is the mirrored one: from the
                        // reflected cue ball to the ghost. Measuring it from
                        // the real cue ball asks where the direct shot crosses
                        // the cushion, which is nowhere.
                        via = meets(from.x, from.y, g.x, g.y, c);
                        if (!via) return;
                        // The object ball is not ignored on the way out: a
                        // cue ball that reaches the cushion by passing through
                        // the ball it is trying to come back to has not kicked
                        // at all, it has played the straight shot the rule
                        // exists to forbid.
                        if (!clear(world, cue.x, cue.y, via.x, via.y, [cue])) return;
                        if (!clear(world, via.x, via.y, g.x, g.y, [cue, ball])) return;
                        if (!clear(world, ball.x, ball.y, pocket.x, pocket.y, [cue, ball])) return;
                        // the cue ball leaves along the real first leg, not the
                        // mirrored one the ghost was measured from
                        g.angle = Math.atan2(via.y - cue.y, via.x - cue.x);
                    }
                    if (g.cut > limit) return;

                    out.push({
                        ball: ball, pocket: pocket, pocketIndex: pi,
                        kind: kind, via: via,
                        angle: g.angle, cut: g.cut,
                        distance: g.distance, toPocket: g.toPocket
                    });
                });
            });
        });

        out.sort(function (a, b) { return a.cut - b.cut; });
        return out;
    }

    /**
     * The shots a player may actually take, house rules included.
     *
     * Direct pots are the whole of it under the standard game, and they stay
     * the whole of it under a house rule too until the shooter is on the 8 -
     * these rules say nothing about any other ball. That is what keeps this
     * cheap: the cushion search only ever runs when exactly one ball is legal,
     * so it costs six pockets by six cushions rather than that times fourteen.
     *
     * @param {Object} opts  {onEight, bank, kick, maxCut}
     * @return {Array} candidates, each `kind` 'direct', 'bank' or 'kick'
     */
    function shortlist(world, legal, opts) {
        opts = opts || {};

        function direct() {
            return candidates(world, legal, opts.maxCut).map(function (c) {
                c.kind = 'direct';
                return c;
            });
        }

        if (!opts.onEight || (!opts.bank && !opts.kick)) return direct();

        // Both rules at once wants a cushion at each end - the cue ball off one
        // on the way out and the 8 off another on the way in. One mirror
        // cannot describe that, and a double reflection is a different search,
        // so it is not offered rather than being offered wrongly.
        if (opts.bank && opts.kick) return [];

        return cushionShots(world, legal, opts.bank ? 'bank' : 'kick', opts.maxCut);
    }

    return {ghost: ghost, clear: clear, blocker: blocker, candidates: candidates,
        mirror: mirror, meets: meets, cushionShots: cushionShots,
        shortlist: shortlist};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Geometry;
