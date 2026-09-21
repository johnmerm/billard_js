/**
 * phys.js - a small, dependency free physics engine for billiards.
 *
 * Everything lives on a horizontal table: x and y span the cloth, z points up.
 * Balls are rigid spheres that roll, slide and spin, so draw, follow and side
 * english all come out of the contact model instead of being faked.
 *
 * Units are SI (metres, kilograms, seconds).
 */
(function (root) {
    'use strict';

    var Phys = {};

    var G = 9.81;

    /* ------------------------------------------------------------------ *
     * Ball
     * ------------------------------------------------------------------ */

    /**
     * @param {number} id    ball number: 0 is the cue ball, 1..15 the objects
     * @param {number} x     table coordinate
     * @param {number} y     table coordinate
     * @param {Object} opts  {radius, mass}
     */
    Phys.Ball = function (id, x, y, opts) {
        opts = opts || {};
        this.id = id;
        this.radius = opts.radius || 0.028575;
        this.mass = opts.mass || 0.17;
        this.active = true;

        // linear state
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;

        // angular velocity, table frame
        this.wx = 0;
        this.wy = 0;
        this.wz = 0;

        // orientation, kept as a quaternion so a renderer can just read it
        this.qx = 0;
        this.qy = 0;
        this.qz = 0;
        this.qw = 1;
    };

    Phys.Ball.prototype.speed = function () {
        return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    };

    Phys.Ball.prototype.moving = function () {
        return this.active && (this.speed() > 1e-4 ||
            Math.abs(this.wx) + Math.abs(this.wy) + Math.abs(this.wz) > 1e-3);
    };

    Phys.Ball.prototype.stop = function () {
        this.vx = this.vy = 0;
        this.wx = this.wy = this.wz = 0;
    };

    Phys.Ball.prototype.placeAt = function (x, y) {
        this.x = x;
        this.y = y;
        this.stop();
        this.active = true;
    };

    /** Integrate the orientation quaternion with the current angular velocity. */
    Phys.Ball.prototype.spinBy = function (h) {
        var wx = this.wx, wy = this.wy, wz = this.wz;
        if (wx === 0 && wy === 0 && wz === 0) return;

        // dq = 0.5 * omega(quaternion) * q * h
        var qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
        var hx = 0.5 * h;
        var nx = qx + hx * (wx * qw + wy * qz - wz * qy);
        var ny = qy + hx * (wy * qw + wz * qx - wx * qz);
        var nz = qz + hx * (wz * qw + wx * qy - wy * qx);
        var nw = qw - hx * (wx * qx + wy * qy + wz * qz);

        var len = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
        this.qx = nx / len;
        this.qy = ny / len;
        this.qz = nz / len;
        this.qw = nw / len;
    };

    /* ------------------------------------------------------------------ *
     * World
     * ------------------------------------------------------------------ */

    /**
     * @param {Object} opts tuning knobs, see the defaults below
     */
    Phys.World = function (opts) {
        opts = opts || {};

        this.balls = [];
        this.cushions = [];   // {x1, y1, x2, y2} segments, gapped at the pockets
        this.pockets = [];    // {x, y, radius}
        this.events = [];     // filled in by every step()

        this.radius = opts.radius || 0.028575;
        this.mass = opts.mass || 0.17;

        this.slidingFriction = opts.slidingFriction || 0.2;
        this.rollingFriction = opts.rollingFriction || 0.010;
        this.spinFriction = opts.spinFriction || 0.022;

        this.ballRestitution = opts.ballRestitution || 0.94;
        this.cushionRestitution = opts.cushionRestitution || 0.85;
        this.cushionFriction = opts.cushionFriction || 0.2;

        this.restSpeed = opts.restSpeed || 0.005;
        this.maxStep = opts.maxStep || 1 / 240;

        // anything that leaves this box has fallen off the table
        this.bounds = opts.bounds || null;
    };

    Phys.World.prototype.add = function (ball) {
        this.balls.push(ball);
        return ball;
    };

    Phys.World.prototype.ball = function (id) {
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].id === id) return this.balls[i];
        }
        return null;
    };

    Phys.World.prototype.activeBalls = function () {
        var out = [];
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].active) out.push(this.balls[i]);
        }
        return out;
    };

    Phys.World.prototype.atRest = function () {
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].moving()) return false;
        }
        return true;
    };

    /**
     * Hit a ball with the cue.
     *
     * @param {Phys.Ball} ball
     * @param {number} dirX  aim direction (need not be normalised)
     * @param {number} dirY
     * @param {number} speed  m/s
     * @param {number} side   horizontal tip offset in ball radii, -1..1
     * @param {number} vert   vertical tip offset in ball radii, -1..1 (up is follow)
     */
    Phys.World.prototype.strike = function (ball, dirX, dirY, speed, side, vert) {
        var len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        var dx = dirX / len, dy = dirY / len;

        side = clamp(side || 0, -0.7, 0.7);
        vert = clamp(vert || 0, -0.7, 0.7);

        ball.vx = dx * speed;
        ball.vy = dy * speed;

        // The tip impulse acts at (side * s, vert * z) away from the centre, so
        // dw = (r_contact x J) / I with I = 2/5 m r^2. Crossing the offsets with
        // the aim direction leaves side spin about z and follow/draw about z x d.
        var k = 2.5 * speed / ball.radius;
        ball.wx = k * vert * -dy;
        ball.wy = k * vert * dx;
        ball.wz = k * side;

        this.events.push({type: 'strike', ball: ball, speed: speed});
    };

    /**
     * Advance the simulation. Substeps are sized so that no ball moves more than
     * a quarter of its radius at a time, which keeps fast balls from tunnelling.
     */
    Phys.World.prototype.step = function (dt) {
        this.events.length = 0;
        dt = Math.min(dt, 0.05);
        if (dt <= 0) return this.events;

        var fastest = 0;
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].active) fastest = Math.max(fastest, this.balls[i].speed());
        }

        var h = this.maxStep;
        if (fastest > 0) h = Math.min(h, 0.25 * this.radius / fastest);

        var steps = Math.min(Math.ceil(dt / h), 600);
        h = dt / steps;
        for (var s = 0; s < steps; s++) this.substep(h);

        return this.events;
    };

    Phys.World.prototype.substep = function (h) {
        var balls = this.balls, i;

        for (i = 0; i < balls.length; i++) {
            if (balls[i].active) this.integrate(balls[i], h);
        }
        this.collideBalls();
        for (i = 0; i < balls.length; i++) {
            if (balls[i].active) this.collideCushions(balls[i]);
        }
        for (i = 0; i < balls.length; i++) {
            if (balls[i].active) this.checkPockets(balls[i]);
        }
    };

    /** Friction, motion and orientation for a single ball. */
    Phys.World.prototype.integrate = function (ball, h) {
        var r = ball.radius;

        // Velocity of the contact patch: v + w x (-r * z)
        var ux = ball.vx - r * ball.wy;
        var uy = ball.vy + r * ball.wx;
        var slip = Math.sqrt(ux * ux + uy * uy);

        // Friction kills the slip at 7/2 mu g: half of that from slowing the
        // ball, the rest from spinning it up. Once a single step would wipe the
        // slip out we snap straight to rolling instead of overshooting, which is
        // what used to leave balls creeping around for ever.
        var a = this.slidingFriction * G;
        if (slip <= 3.5 * a * h) slip = 0;

        if (slip > 0) {
            // Sliding: kinetic friction slows the contact patch and spins the ball
            // up until it rolls, which is what turns follow and draw into motion.
            var nx = ux / slip, ny = uy / slip;

            ball.vx -= a * nx * h;
            ball.vy -= a * ny * h;

            var alpha = 2.5 * a / r;
            ball.wx -= alpha * ny * h;
            ball.wy += alpha * nx * h;
        } else {
            // Rolling: only the much smaller rolling resistance is left.
            var v = ball.speed();
            if (v > 0) {
                var dv = this.rollingFriction * G * h;
                if (dv >= v) {
                    ball.vx = ball.vy = 0;
                } else {
                    ball.vx -= dv * ball.vx / v;
                    ball.vy -= dv * ball.vy / v;
                }
            }
            // keep the roll locked to the direction of travel
            ball.wx = -ball.vy / r;
            ball.wy = ball.vx / r;
        }

        // Spin about the vertical axis just bleeds away against the cloth.
        var dw = 2.5 * this.spinFriction * G * h / r;
        if (Math.abs(ball.wz) <= dw) ball.wz = 0;
        else ball.wz -= dw * (ball.wz > 0 ? 1 : -1);

        if (ball.speed() < this.restSpeed && Math.abs(ball.wz) < 0.5) ball.stop();

        ball.x += ball.vx * h;
        ball.y += ball.vy * h;
        ball.spinBy(h);
    };

    /** Elastic impulses between every overlapping pair. */
    Phys.World.prototype.collideBalls = function () {
        var balls = this.balls;
        for (var i = 0; i < balls.length; i++) {
            var a = balls[i];
            if (!a.active) continue;
            for (var j = i + 1; j < balls.length; j++) {
                var b = balls[j];
                if (!b.active) continue;

                var dx = b.x - a.x, dy = b.y - a.y;
                var min = a.radius + b.radius;
                var d2 = dx * dx + dy * dy;
                if (d2 >= min * min || d2 === 0) continue;

                var d = Math.sqrt(d2);
                var nx = dx / d, ny = dy / d;

                // push the pair apart so they do not stay welded together
                var overlap = min - d;
                a.x -= nx * overlap * 0.5;
                a.y -= ny * overlap * 0.5;
                b.x += nx * overlap * 0.5;
                b.y += ny * overlap * 0.5;

                var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
                var vn = rvx * nx + rvy * ny;
                if (vn > 0) continue; // already separating

                var e = this.ballRestitution;
                var inv = 1 / a.mass + 1 / b.mass;
                var jimp = -(1 + e) * vn / inv;

                a.vx -= jimp * nx / a.mass;
                a.vy -= jimp * ny / a.mass;
                b.vx += jimp * nx / b.mass;
                b.vy += jimp * ny / b.mass;

                this.events.push({
                    type: 'ballHit', a: a, b: b, speed: Math.abs(vn),
                    x: a.x + nx * a.radius, y: a.y + ny * a.radius
                });
            }
        }
    };

    /** Bounce off the rail segments; the segment ends double as pocket jaws. */
    Phys.World.prototype.collideCushions = function (ball) {
        for (var i = 0; i < this.cushions.length; i++) {
            var c = this.cushions[i];
            var ex = c.x2 - c.x1, ey = c.y2 - c.y1;
            var len2 = ex * ex + ey * ey;
            var t = len2 > 0 ? ((ball.x - c.x1) * ex + (ball.y - c.y1) * ey) / len2 : 0;
            t = clamp(t, 0, 1);

            var px = c.x1 + ex * t, py = c.y1 + ey * t;
            var dx = ball.x - px, dy = ball.y - py;
            var d2 = dx * dx + dy * dy;
            if (d2 >= ball.radius * ball.radius) continue;

            var d = Math.sqrt(d2);
            var nx, ny;
            if (d > 1e-9) {
                nx = dx / d; ny = dy / d;
            } else {
                nx = -ey / Math.sqrt(len2); ny = ex / Math.sqrt(len2);
                d = 0;
            }

            ball.x = px + nx * ball.radius;
            ball.y = py + ny * ball.radius;

            var vn = ball.vx * nx + ball.vy * ny;
            if (vn >= 0) continue;

            var tx = -ny, ty = nx;
            var vt = ball.vx * tx + ball.vy * ty;

            // side spin nudges the ball along the rail, the way english does,
            // but never by more than the impact itself carried
            var throw_ = this.cushionFriction * ball.wz * ball.radius;
            var limit = Math.abs(vn) * 0.5;
            vt += clamp(throw_, -limit, limit);
            ball.wz *= 0.6;

            var e = c.restitution === undefined ? this.cushionRestitution : c.restitution;
            vn = -vn * e;
            vt *= 0.96;

            ball.vx = nx * vn + tx * vt;
            ball.vy = ny * vn + ty * vt;

            if (Math.abs(vn) > 0.02) {
                this.events.push({type: 'cushion', ball: ball, x: px, y: py, speed: Math.abs(vn)});
            }
        }
    };

    Phys.World.prototype.checkPockets = function (ball) {
        for (var i = 0; i < this.pockets.length; i++) {
            var p = this.pockets[i];
            var dx = ball.x - p.x, dy = ball.y - p.y;
            if (dx * dx + dy * dy <= p.radius * p.radius) {
                ball.active = false;
                ball.stop();
                this.events.push({type: 'pot', ball: ball, pocket: p});
                return;
            }
        }

        // The rails seal the cloth everywhere except the pocket mouths, so a ball
        // whose centre has crossed the rail line is already in a pocket throat:
        // drop it in the nearest one instead of letting it die in the recess.
        var m = this.width !== undefined ? 0.15 * ball.radius : Infinity;
        var past = this.width !== undefined && (
            ball.x < -m || ball.x > this.width + m ||
            ball.y < -m || ball.y > this.height + m);

        var b = this.bounds;
        if (past || (b && (ball.x < b.x1 || ball.x > b.x2 || ball.y < b.y1 || ball.y > b.y2))) {
            var best = null, bestD = Infinity;
            for (var k = 0; k < this.pockets.length; k++) {
                var q = this.pockets[k];
                var qd = (ball.x - q.x) * (ball.x - q.x) + (ball.y - q.y) * (ball.y - q.y);
                if (qd < bestD) { bestD = qd; best = q; }
            }
            ball.active = false;
            ball.stop();
            this.events.push({type: 'pot', ball: ball, pocket: best});
        }
    };

    /**
     * Where would a ball fired from (x, y) along (dx, dy) first make contact?
     * Used to draw the aiming guide.
     *
     * @return {?Object} {type: 'ball'|'cushion', x, y, distance, ball, nx, ny}
     */
    Phys.World.prototype.firstContact = function (x, y, dx, dy, ignore) {
        var len = Math.sqrt(dx * dx + dy * dy);
        if (!len) return null;
        dx /= len; dy /= len;

        var r = this.radius;
        var best = null;

        for (var i = 0; i < this.balls.length; i++) {
            var b = this.balls[i];
            if (!b.active || b === ignore) continue;

            // ray against a circle of radius 2r around the target centre
            var ox = b.x - x, oy = b.y - y;
            var proj = ox * dx + oy * dy;
            if (proj <= 0) continue;
            var perp2 = ox * ox + oy * oy - proj * proj;
            var rr = 4 * r * r;
            if (perp2 > rr) continue;

            var t = proj - Math.sqrt(rr - perp2);
            if (t < 0) continue;
            if (!best || t < best.distance) {
                var cx = x + dx * t, cy = y + dy * t;
                var nx = (b.x - cx) / (2 * r), ny = (b.y - cy) / (2 * r);
                best = {type: 'ball', x: cx, y: cy, distance: t, ball: b, nx: nx, ny: ny};
            }
        }

        for (var j = 0; j < this.cushions.length; j++) {
            var c = this.cushions[j];
            var hit = raySegment(x, y, dx, dy, c, r);
            if (hit && (!best || hit.distance < best.distance)) best = hit;
        }

        return best;
    };

    /* ------------------------------------------------------------------ *
     * Table construction
     * ------------------------------------------------------------------ */

    /**
     * Build a world shaped like a pool table: playing surface [0, width] x
     * [0, height], six pockets, and rails that stop short of every pocket.
     */
    Phys.createTable = function (opts) {
        opts = opts || {};
        var w = opts.width || 2.24;
        var h = opts.height || 1.12;
        var r = opts.radius || 0.028575;

        var world = new Phys.World({radius: r, mass: opts.mass});
        world.width = w;
        world.height = h;

        var cornerMouth = 3.0 * r;   // half the corner pocket opening, along a rail
        var sideMouth = 2.6 * r;     // half the side pocket opening
        var jaw = 1.8 * r;           // how far the 45 degree jaw cut runs back
        var recess = 3.2 * r;        // depth of the pocket recess behind the rails

        world.pocketRadius = 2.0 * r;
        world.bounds = {
            x1: -recess * 2, y1: -recess * 2,
            x2: w + recess * 2, y2: h + recess * 2
        };

        // Pocket centres sit just behind the mouth, so a ball only drops once it
        // has actually passed between the jaws.
        var co = 0.9 * r;            // corner centres, pushed out along the diagonal
        var so = 1.0 * r;            // side centres, pushed straight out
        world.pockets = [
            {x: -co, y: -co, radius: 2.0 * r, corner: true},
            {x: w / 2, y: -so, radius: 1.75 * r, corner: false},
            {x: w + co, y: -co, radius: 2.0 * r, corner: true},
            {x: -co, y: h + co, radius: 2.0 * r, corner: true},
            {x: w / 2, y: h + so, radius: 1.75 * r, corner: false},
            {x: w + co, y: h + co, radius: 2.0 * r, corner: true}
        ];

        var c = [];

        function rail(x1, y1, x2, y2) {
            c.push({x1: x1, y1: y1, x2: x2, y2: y2});
        }
        function jawCut(x, y, dx, dy) {
            // cushion face cut back at 45 degrees into the pocket recess
            var k = jaw * Math.SQRT1_2;
            c.push({x1: x, y1: y, x2: x + dx * k, y2: y + dy * k, restitution: 0.4});
        }

        // long rails, broken at the side pockets and short of every corner
        rail(cornerMouth, 0, w / 2 - sideMouth, 0);
        rail(w / 2 + sideMouth, 0, w - cornerMouth, 0);
        rail(cornerMouth, h, w / 2 - sideMouth, h);
        rail(w / 2 + sideMouth, h, w - cornerMouth, h);

        // short rails
        rail(0, cornerMouth, 0, h - cornerMouth);
        rail(w, cornerMouth, w, h - cornerMouth);

        // corner jaws
        jawCut(cornerMouth, 0, 1, -1);
        jawCut(0, cornerMouth, -1, 1);
        jawCut(w - cornerMouth, 0, -1, -1);
        jawCut(w, cornerMouth, 1, 1);
        jawCut(cornerMouth, h, 1, 1);
        jawCut(0, h - cornerMouth, -1, -1);
        jawCut(w - cornerMouth, h, -1, 1);
        jawCut(w, h - cornerMouth, 1, -1);

        // side jaws
        jawCut(w / 2 - sideMouth, 0, -1, -1);
        jawCut(w / 2 + sideMouth, 0, 1, -1);
        jawCut(w / 2 - sideMouth, h, -1, 1);
        jawCut(w / 2 + sideMouth, h, 1, 1);

        // dead outer wall: a ball that rattles without dropping stays in the
        // recess instead of escaping the table
        var m = recess;
        c.push({x1: -m, y1: -m, x2: w + m, y2: -m, restitution: 0.15});
        c.push({x1: -m, y1: h + m, x2: w + m, y2: h + m, restitution: 0.15});
        c.push({x1: -m, y1: -m, x2: -m, y2: h + m, restitution: 0.15});
        c.push({x1: w + m, y1: -m, x2: w + m, y2: h + m, restitution: 0.15});

        world.cushions = c;
        return world;
    };

    /* ------------------------------------------------------------------ *
     * helpers
     * ------------------------------------------------------------------ */

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** Ray against a rail segment offset outward by the ball radius. */
    function raySegment(x, y, dx, dy, c, r) {
        var ex = c.x2 - c.x1, ey = c.y2 - c.y1;
        var len = Math.sqrt(ex * ex + ey * ey);
        if (!len) return null;
        ex /= len; ey /= len;

        var nx = -ey, ny = ex;
        if ((x - c.x1) * nx + (y - c.y1) * ny < 0) { nx = -nx; ny = -ny; }

        var denom = dx * nx + dy * ny;
        if (denom >= -1e-9) return null; // travelling away from this rail

        var t = (r - ((x - c.x1) * nx + (y - c.y1) * ny)) / denom;
        if (t < 0) return null;

        var px = x + dx * t, py = y + dy * t;
        var along = (px - c.x1) * ex + (py - c.y1) * ey;
        if (along < 0 || along > len) return null;

        return {type: 'cushion', x: px, y: py, distance: t, nx: nx, ny: ny, cushion: c};
    }

    Phys.clamp = clamp;

    root.Phys = Phys;
    if (typeof module === 'object' && module.exports) module.exports = Phys;

})(typeof window !== 'undefined' ? window : globalThis);
