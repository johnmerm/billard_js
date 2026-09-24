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

    return {ghost: ghost, clear: clear, blocker: blocker, candidates: candidates};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Geometry;
