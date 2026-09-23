/**
 * phys.js - the pool table, simulated with cannon-es.
 *
 * cannon-es does the physics: the balls are rigid spheres with friction against
 * the cloth, so a ball struck below centre comes back and one struck above it
 * follows through, all out of the contact solver rather than out of any special
 * case here. This file is the table around that - geometry, pockets, the cue
 * strike, and the events the game reads - plus the one thing a general purpose
 * engine has no reason to model: rolling resistance, the slow drag of cloth that
 * brings a rolling ball to a stop.
 *
 * Two coordinate systems meet here. The game thinks in table coordinates: x
 * along the length and y across the width, both starting at zero in a corner.
 * cannon (and three.js) work in a y-up world centred on the table, so
 *
 *     world = (x - W/2, height, H/2 - y)
 *
 * Positions and directions cross that line; orientations never do, because the
 * renderer takes ball quaternions straight from the bodies.
 *
 * Units are SI: a 2.24 x 1.12 m surface, 57.15 mm balls, 170 g each.
 */
(function (root) {
    'use strict';

    var CANNON = root.CANNON;
    if (!CANNON && typeof require === 'function') CANNON = require('./lib/cannon-es.js');
    if (!CANNON) throw new Error('phys.js needs cannon-es to be loaded first');

    var Phys = {};

    var G = 9.82;
    var BALL_RADIUS = 0.028575;
    var BALL_MASS = 0.17;

    // A hard break moves a ball about 8 m/s; at 1/480 s that is 17 mm a step,
    // well under a ball radius, so nothing tunnels through the rack.
    var FIXED_STEP = 1 / 480;
    // 48 steps of 1/480 is exactly the 0.1s that `step` clamps a frame to, so
    // no frame short enough to be worth simulating ever loses time to the cap
    var MAX_SUB_STEPS = 48;

    var REST_SPEED = 0.008;     // below this the cloth simply holds the ball

    // Materials are shared: every table uses the same cloth, rubber and phenolic.
    var ballMaterial = new CANNON.Material('ball');
    var clothMaterial = new CANNON.Material('cloth');
    var cushionMaterial = new CANNON.Material('cushion');

    Phys.materials = {ball: ballMaterial, cloth: clothMaterial, cushion: cushionMaterial};
    Phys.CANNON = CANNON;

    /* ------------------------------------------------------------------ *
     * Ball
     * ------------------------------------------------------------------ */

    /**
     * @param {number} id  0 is the cue ball, 1..15 the object balls
     * @param {number} x   table coordinate, set properly when it joins a table
     * @param {number} y   table coordinate
     */
    Phys.Ball = function (id, x, y) {
        this.id = id;
        this.radius = BALL_RADIUS;
        this.mass = BALL_MASS;
        this.active = true;
        this.table = null;

        this._x = x || 0;
        this._y = y || 0;

        var body = new CANNON.Body({mass: BALL_MASS, material: ballMaterial});
        body.addShape(new CANNON.Sphere(BALL_RADIUS));
        body.linearDamping = 0;
        body.angularDamping = 0;

        // cannon works the inertia out from a body's bounding box, which for a
        // sphere is the box around it: 2/3 m r^2, the figure for a hollow shell,
        // two thirds again too heavy to turn. Every bit of spin the tip puts on
        // the ball would come out at 60% strength, so set the real sphere value.
        var inertia = 0.4 * BALL_MASS * BALL_RADIUS * BALL_RADIUS;
        body.inertia.set(inertia, inertia, inertia);
        body.invInertia.set(1 / inertia, 1 / inertia, 1 / inertia);
        body.updateInertiaWorld(true);
        // No sleeping: cannon leaves sleeping bodies out of the solver, so a
        // resting ball would swallow part of the impulse when it got hit. The
        // cloth pass below is what actually brings balls to a stop.
        body.allowSleep = false;
        body.ball = this;                  // so collide events can name the ball
        this.body = body;

        var self = this;

        // Table coordinates, read straight off the rigid body - until the ball
        // joins a table, the constructor arguments stand in.
        Object.defineProperty(this, 'x', {
            get: function () {
                return self.table ? body.position.x + self.table.width / 2 : self._x;
            }
        });
        Object.defineProperty(this, 'y', {
            get: function () {
                return self.table ? self.table.height / 2 - body.position.z : self._y;
            }
        });
        Object.defineProperty(this, 'vx', {get: function () { return body.velocity.x; }});
        Object.defineProperty(this, 'vy', {get: function () { return -body.velocity.z; }});
        Object.defineProperty(this, 'height', {get: function () { return body.position.y; }});
    };

    Phys.Ball.prototype.speed = function () {
        var v = this.body.velocity;
        return Math.sqrt(v.x * v.x + v.z * v.z);
    };

    /** True while the ball still has something to do - including falling in. */
    Phys.Ball.prototype.moving = function () {
        if (!this.active) return false;
        if (this.body.position.y < this.radius * 0.7) return true;   // dropping into a pocket
        // a ball turning on the spot is going nowhere: it does not hold up play
        return this.speed() > REST_SPEED ||
            Math.abs(this.body.angularVelocity.x) + Math.abs(this.body.angularVelocity.z) > 1.0;
    };

    Phys.Ball.prototype.stop = function () {
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
    };

    /**
     * Take the ball off the table without potting it: the cue ball is in hand,
     * and a ball being carried around should not be shouldering the others out
     * of the way while its owner decides where to put it down.
     */
    Phys.Ball.prototype.lift = function () {
        if (!this.table || !this.active) return;
        this.stop();
        this.table.cannon.removeBody(this.body);
        this.active = false;
    };

    /** Put the ball on the cloth at a table coordinate, bringing it back if potted. */
    Phys.Ball.prototype.placeAt = function (x, y) {
        if (!this.table) {
            this._x = x;
            this._y = y;
            return;
        }
        var t = this.table;
        this.body.position.set(x - t.width / 2, this.radius, t.height / 2 - y);
        this.stop();
        this.body.wakeUp();
        if (!this.active) {
            t.cannon.addBody(this.body);
            this.active = true;
        }
    };

    /* ------------------------------------------------------------------ *
     * Table
     * ------------------------------------------------------------------ */

    function Table(opts) {
        opts = opts || {};

        this.width = opts.width || 2.24;
        this.height = opts.height || 1.12;
        this.radius = BALL_RADIUS;

        this.balls = [];
        this.pockets = [];
        this.cushions = [];       // table coordinate segments, also drawn by the renderer
        this.events = [];

        this.carry = 0;           // time handed in but not yet stepped
        this.slateBounce = opts.slateBounce !== undefined ? opts.slateBounce : 0.45;
        this.slidingFriction = opts.slidingFriction !== undefined ? opts.slidingFriction : 0.2;
        this.rollingFriction = opts.rollingFriction !== undefined ? opts.rollingFriction : 0.012;
        this.spinFriction = opts.spinFriction !== undefined ? opts.spinFriction : 0.6;
        this.stoppedSpinFriction = opts.stoppedSpinFriction !== undefined
            ? opts.stoppedSpinFriction : 0.95;

        var world = new CANNON.World();
        world.gravity.set(0, -G, 0);
        world.broadphase = new CANNON.NaiveBroadphase();   // sixteen balls, nothing clever needed
        world.solver.iterations = 30;
        world.solver.tolerance = 1e-5;
        world.allowSleep = false;
        this.cannon = world;

        // The cloth is handled in `cloth()` below rather than by the solver, so
        // the contact itself is frictionless as far as cannon is concerned.
        this.clothContact = new CANNON.ContactMaterial(ballMaterial, clothMaterial, {
            friction: 0,
            restitution: 0.05
        });
        world.addContactMaterial(this.clothContact);
        // Stiff, barely relaxed contacts: the defaults are tuned for boxes
        // settling into stacks, and they soak up an impact between two balls.
        // Ball on ball friction is kept low on purpose: cannon's friction
        // impulse is generous at this scale, and anything higher spins the
        // object ball up at the expense of the speed it should be leaving with.
        world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
            friction: 0.01,
            restitution: opts.ballRestitution !== undefined ? opts.ballRestitution : 0.95,
            contactEquationStiffness: 1e9,
            contactEquationRelaxation: 1
        }));
        world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, cushionMaterial, {
            friction: 0.2,
            restitution: opts.cushionRestitution !== undefined ? opts.cushionRestitution : 0.8,
            contactEquationStiffness: 1e9,
            contactEquationRelaxation: 1
        }));

        this.build();

        var self = this;
        world.addEventListener('preStep', function () {
            self.cloth();
        });
        world.addEventListener('postStep', function () {
            self.settle();
        });
    }

    Phys.Table = Table;

    /** The bed and the rails. */
    Table.prototype.build = function () {
        var W = this.width, H = this.height, r = this.radius;

        // The bed is the playing surface with the pockets cut out of it, so the
        // only way off it is down a hole: a ball that gets far enough over one
        // runs out of cloth and drops, the way it does on a real table.
        //
        // It was one box across the whole table to begin with, on the reasoning
        // that the rail line is where the cloth ends. It is not - the pockets
        // are holes in the middle of that line, and a ball could sit dead centre
        // over one, on top of cloth that should not have been there, hovering
        // over the hole it was supposed to have fallen down.
        //
        // Cannon has boxes and not much else, so the holes are square. The
        // rounded shape a player sees is the drawn one; what this has to get
        // right is where the support stops, and a square notch the size of the
        // mouth does that well enough - a ball over the middle of a pocket falls,
        // one on the cloth does not, and the jaws already shape the approach.
        var bed = new CANNON.Body({mass: 0, material: clothMaterial});
        var corner = 2.0 * r;        // how far a corner pocket eats into the bed
        var side = 1.75 * r;         // and a middle one, along the rail and back

        // Where the cloth is not, so a renderer can draw the hole that was
        // actually cut rather than a rounder one that does not match it.
        this.pocketCuts = [
            {x1: 0, y1: 0, x2: corner, y2: corner},
            {x1: W - corner, y1: 0, x2: W, y2: corner},
            {x1: 0, y1: H - corner, x2: corner, y2: H},
            {x1: W - corner, y1: H - corner, x2: W, y2: H},
            {x1: W / 2 - side, y1: 0, x2: W / 2 + side, y2: side},
            {x1: W / 2 - side, y1: H - side, x2: W / 2 + side, y2: H}
        ];

        /** One rectangle of cloth, in table coordinates. */
        function cloth(x1, y1, x2, y2) {
            if (x2 - x1 < 1e-6 || y2 - y1 < 1e-6) return;
            bed.addShape(
                new CANNON.Box(new CANNON.Vec3((x2 - x1) / 2, 0.02, (y2 - y1) / 2)),
                new CANNON.Vec3((x1 + x2) / 2 - W / 2, -0.02, H / 2 - (y1 + y2) / 2)
            );
        }

        // Three bands up the table, and the mirror of the first two at the far
        // rail. Nearest the rail the corners and the middle pocket are all
        // missing; a little further in only the corners are; past that the cloth
        // runs the full width.
        [0, 1].forEach(function (end) {
            var flip = function (y) { return end ? H - y : y; };
            var lo = Math.min(flip(0), flip(side)), hi = Math.max(flip(0), flip(side));
            cloth(corner, lo, W / 2 - side, hi);
            cloth(W / 2 + side, lo, W - corner, hi);

            lo = Math.min(flip(side), flip(corner));
            hi = Math.max(flip(side), flip(corner));
            cloth(corner, lo, W - corner, hi);
        });
        cloth(0, corner, W, H - corner);

        bed.isCloth = true;
        this.cannon.addBody(bed);
        this.bed = bed;

        var cornerMouth = 3.0 * r;   // half the corner pocket opening, along a rail
        var sideMouth = 2.6 * r;     // half the side pocket opening
        var jaw = 1.8 * r;           // how far the 45 degree jaw cut runs back

        this.pockets = [
            {x: 0, y: 0, radius: 2.0 * r, corner: true},
            {x: W / 2, y: 0, radius: 1.75 * r, corner: false},
            {x: W, y: 0, radius: 2.0 * r, corner: true},
            {x: 0, y: H, radius: 2.0 * r, corner: true},
            {x: W / 2, y: H, radius: 1.75 * r, corner: false},
            {x: W, y: H, radius: 2.0 * r, corner: true}
        ];

        var c = [];
        function rail(x1, y1, x2, y2) {
            c.push({x1: x1, y1: y1, x2: x2, y2: y2});
        }
        function jawCut(x, y, dx, dy) {
            var k = jaw * Math.SQRT1_2;    // cushion face cut back at 45 degrees
            c.push({x1: x, y1: y, x2: x + dx * k, y2: y + dy * k, jaw: true});
        }

        rail(cornerMouth, 0, W / 2 - sideMouth, 0);
        rail(W / 2 + sideMouth, 0, W - cornerMouth, 0);
        rail(cornerMouth, H, W / 2 - sideMouth, H);
        rail(W / 2 + sideMouth, H, W - cornerMouth, H);
        rail(0, cornerMouth, 0, H - cornerMouth);
        rail(W, cornerMouth, W, H - cornerMouth);

        jawCut(cornerMouth, 0, 1, -1);
        jawCut(0, cornerMouth, -1, 1);
        jawCut(W - cornerMouth, 0, -1, -1);
        jawCut(W, cornerMouth, 1, 1);
        jawCut(cornerMouth, H, 1, 1);
        jawCut(0, H - cornerMouth, -1, -1);
        jawCut(W - cornerMouth, H, -1, 1);
        jawCut(W, H - cornerMouth, 1, -1);

        jawCut(W / 2 - sideMouth, 0, -1, -1);
        jawCut(W / 2 + sideMouth, 0, 1, -1);
        jawCut(W / 2 - sideMouth, H, -1, 1);
        jawCut(W / 2 + sideMouth, H, 1, 1);

        this.cushions = c;

        // The rubber a player sees is about half a ball high, but a box that
        // short is trouble: a ball arriving at break speed covers most of the
        // cushion's depth in one step, and the nearest way out of the box is
        // then over the top rather than back the way it came - the solver duly
        // launched the cue ball into the air and it sailed off the end of the
        // table. The bodies are built shoulder high instead, well above any ball,
        // and the renderer draws the rubber at its proper height from the same
        // segments.
        var wallHeight = r * 3, depth = r * 1.6, skirt = 0.06;
        for (var i = 0; i < c.length; i++) this.addCushion(c[i], wallHeight, depth, skirt);
    };

    /** One rail segment, as a box standing on the outside of the playing surface. */
    Table.prototype.addCushion = function (seg, height, depth, skirt) {
        var W = this.width, H = this.height;

        var x1 = seg.x1 - W / 2, z1 = H / 2 - seg.y1;
        var x2 = seg.x2 - W / 2, z2 = H / 2 - seg.y2;
        var dx = x2 - x1, dz = z2 - z1;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (!len) return;

        var mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;

        // normal pointing away from the middle of the table
        var nx = -dz / len, nz = dx / len;
        if (nx * -mx + nz * -mz > 0) { nx = -nx; nz = -nz; }

        var body = new CANNON.Body({mass: 0, material: cushionMaterial});
        body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, (height + skirt) / 2, depth / 2)));
        body.position.set(mx + nx * depth / 2, (height - skirt) / 2, mz + nz * depth / 2);
        // a box's local +x runs along the segment; +y rotation turns +x towards -z
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.atan2(-dz, dx));
        body.isCushion = true;
        this.cannon.addBody(body);
    };

    /**
     * What the cloth does between solver steps: bleed off rolling balls, damp
     * spin about the vertical axis, and hold anything that has all but stopped.
     */
    /**
     * The cloth, worked out here rather than left to the solver.
     *
     * cannon's friction turns a sliding ball into a rolling one almost the
     * instant it lands - eight milliseconds where the real thing takes the best
     * part of a second - and it barely responds to the friction coefficient at
     * all. That transition is the whole of draw and follow: a ball struck low
     * has to keep its backspin long enough to reach the object ball, or draw
     * does not exist. So the contact material is frictionless and the patch
     * where ball meets cloth is modelled directly.
     *
     * The velocity of that patch decides everything. While it is slipping,
     * kinetic friction slows the ball and spins it towards rolling; once it
     * rolls, only the much smaller rolling resistance is left.
     */
    Table.prototype.cloth = function () {
        var h = FIXED_STEP;
        var slide = this.slidingFriction * G;        // how hard the cloth bites
        var drop = this.rollingFriction * G * h;     // and what it costs to roll
        var spinDecay = Math.pow(1 - this.spinFriction, h);
        // A ball going nowhere scrubs its whole contact patch against the cloth
        // rather than rolling over it, so the last of the english comes off much
        // faster than it does while the ball is still travelling.
        var stoppedDecay = Math.pow(1 - this.stoppedSpinFriction, h);

        // A ball on ball hit is over in a fraction of a millisecond; the cloth
        // cannot do anything in that time, and letting it try would scrub off
        // the spin the cue ball is supposed to carry through the collision.
        if (this.impacting()) return;

        for (var i = 0; i < this.balls.length; i++) {
            var ball = this.balls[i];
            if (!ball.active) continue;

            var body = ball.body, r = ball.radius;
            if (body.position.y > r * 1.4) continue;      // airborne or dropping in

            var v = body.velocity, w = body.angularVelocity;

            // the patch is at the bottom of the ball: u = v + w x (0, -r, 0)
            var ux = v.x + w.z * r;
            var uz = v.z - w.x * r;
            var slip = Math.sqrt(ux * ux + uz * uz);

            // Friction kills the slip at 7/2 mu g - half from slowing the ball,
            // the rest from spinning it up. Once a step would wipe it out, snap
            // to rolling rather than overshoot into a wobble.
            if (slip > 3.5 * slide * h) {
                var nx = ux / slip, nz = uz / slip;

                v.x -= slide * nx * h;
                v.z -= slide * nz * h;

                var alpha = 2.5 * slide / r;
                w.x += alpha * nz * h;
                w.z -= alpha * nx * h;
            } else {
                var speed = Math.sqrt(v.x * v.x + v.z * v.z);
                if (speed > drop) {
                    v.x -= drop * v.x / speed;
                    v.z -= drop * v.z / speed;
                } else {
                    v.x = v.z = 0;
                }
                // hold it exactly on the rolling condition
                w.x = v.z / r;
                w.z = -v.x / r;
            }

            // spin about the vertical axis just bleeds away against the cloth
            w.y *= spinDecay;

            // A ball that has stopped dead but is still spinning is not at rest:
            // that is a cue ball the instant after a full ball hit, and the spin
            // it holds is what makes it follow through or draw back.
            // Only spin about a horizontal axis can set the ball moving again;
            // spin about the vertical just turns on the spot, so it does not
            // hold up the shot - but it does have to stop, and exactly. Left to
            // the rolling decay it takes six seconds to become invisible and
            // never quite reaches nothing, which on a table where nothing else
            // is moving reads as a bug rather than as physics.
            var still = Math.sqrt(v.x * v.x + v.z * v.z);
            if (still < REST_SPEED && Math.abs(w.x) + Math.abs(w.z) < 1.0) {
                v.x = v.z = 0;
                w.x = w.z = 0;
                w.y *= stoppedDecay;
                if (Math.abs(w.y) < 0.02) w.y = 0;
            }
        }
    };

    /**
     * Run after the solver, to undo the one thing a box shaped cushion gets
     * badly wrong.
     *
     * A real cushion meets the ball above its equator: the nose overhangs, so
     * the contact pushes down as well as back and the ball stays on the cloth.
     * A flat vertical face does the opposite - friction against a ball arriving
     * with heavy topspin climbs it - and at break speed that threw the cue ball
     * 19 cm into the air and clean off the end of the table.
     */
    Table.prototype.settle = function () {
        for (var i = 0; i < this.balls.length; i++) {
            var ball = this.balls[i];
            if (!ball.hitRail) continue;
            ball.hitRail = false;
            if (!ball.active) continue;

            var v = ball.body.velocity;
            if (v.y > 0) v.y *= 0.15;
        }
    };

    /** Are any two balls in contact right now? */
    Table.prototype.impacting = function () {
        var balls = this.balls;
        var reach = 2 * this.radius + 0.0015;      // plus a step's worth of approach
        var reach2 = reach * reach;

        for (var i = 0; i < balls.length; i++) {
            var a = balls[i];
            if (!a.active) continue;
            var ap = a.body.position;
            for (var j = i + 1; j < balls.length; j++) {
                var b = balls[j];
                if (!b.active) continue;
                var bp = b.body.position;
                var dx = bp.x - ap.x, dy = bp.y - ap.y, dz = bp.z - ap.z;
                if (dx * dx + dy * dy + dz * dz < reach2) return true;
            }
        }
        return false;
    };

    /* ----------------------------- balls ------------------------------ */

    Table.prototype.add = function (ball) {
        ball.table = this;
        this.balls.push(ball);
        this.cannon.addBody(ball.body);
        ball.placeAt(ball._x, ball._y);
        this.listen(ball);
        return ball;
    };

    /** Turn cannon's contact events into the events the game reads. */
    Table.prototype.listen = function (ball) {
        var self = this;
        ball.body.addEventListener('collide', function (e) {
            var other = e.body;
            if (!other || other.isCloth) return;

            // Collide events arrive before the solver has applied its impulses,
            // so the lift a cushion gives the ball is taken back out afterwards,
            // in settle() below.
            if (other.isCushion) ball.hitRail = true;

            var speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
            if (speed < 0.05) return;

            if (other.ball) {
                if (ball.id < other.ball.id) {     // report each pair once
                    self.events.push({
                        type: 'ballHit', a: ball, b: other.ball, speed: speed,
                        x: (ball.x + other.ball.x) / 2, y: (ball.y + other.ball.y) / 2
                    });
                }
            } else if (other.isCushion) {
                self.events.push({type: 'cushion', ball: ball, speed: speed, x: ball.x, y: ball.y});
            }
        });
    };

    Table.prototype.ball = function (id) {
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].id === id) return this.balls[i];
        }
        return null;
    };

    Table.prototype.activeBalls = function () {
        return this.balls.filter(function (b) { return b.active; });
    };

    Table.prototype.atRest = function () {
        for (var i = 0; i < this.balls.length; i++) {
            if (this.balls[i].moving()) return false;
        }
        return true;
    };

    /* ----------------------------- the shot --------------------------- */

    /**
     * Hit a ball with the cue: an impulse applied off centre, which is all
     * cannon needs to produce draw, follow and english.
     *
     * Raise the butt of the cue and the impulse points downwards instead of
     * along the cloth. The ball is driven into the slate, which is rigid and
     * hands most of it straight back: that rebound is the jump. The bed contact
     * cannot do this itself - a ball resting on it is already touching, so
     * there is nothing to fall through - so the bounce is put in here, and the
     * ball leaves at roughly half the angle the cue was raised to, which is
     * what a jump shot does.
     *
     * @param {Phys.Ball} ball
     * @param {number} dirX   aim direction in table coordinates
     * @param {number} dirY
     * @param {number} speed  m/s
     * @param {number} side   sideways tip offset in ball radii, -1..1 (right is positive)
     * @param {number} vert   vertical tip offset in ball radii, -1..1 (up is follow)
     * @param {number} elev   how far the cue is raised, in radians, 0 is level
     */
    Table.prototype.strike = function (ball, dirX, dirY, speed, side, vert, elev) {
        var len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (!len) return;

        side = clamp(side || 0, -0.7, 0.7);
        vert = clamp(vert || 0, -0.7, 0.7);
        elev = clamp(elev || 0, 0, 1.2);                // up to about 69 degrees

        var along = Math.cos(elev), into = Math.sin(elev);
        var dx = dirX / len, dz = -dirY / len;          // aim, in world coordinates
        var sx = -dz, sz = dx;                          // the player's right hand side

        // the cue's own axes: down the shaft, and square to it
        var ix = dx * along, iy = -into, iz = dz * along;
        var ux = -sz * iy, uy = sz * ix - sx * iz, uz = sx * iy;
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;

        var reach = Math.sqrt(Math.max(0, 1 - side * side - vert * vert));
        var r = ball.radius, body = ball.body;

        // where the tip meets the ball, as an offset from its centre
        var tip = new CANNON.Vec3(
            (sx * side + ux * vert - ix * reach) * r,
            (uy * vert - iy * reach) * r,
            (sz * side + uz * vert - iz * reach) * r
        );

        body.wakeUp();
        body.applyImpulse(new CANNON.Vec3(
            ix * speed * ball.mass,
            iy * speed * ball.mass,
            iz * speed * ball.mass
        ), tip);

        // the slate throws back most of what was driven into it
        if (into > 0) body.velocity.y = this.slateBounce * speed * into;

        this.events.push({type: 'strike', ball: ball, speed: speed, elevation: elev});
    };

    /* ----------------------------- stepping --------------------------- */

    /**
     * Advance the table by dt seconds and return what happened.
     * cannon does the stepping; this collects the events and clears the pockets.
     */
    /**
     * Advance the table by `dt` seconds of real time.
     *
     * The sub stepping is done here rather than by handing cannon a variable
     * dt, because cannon's own loop watches the wall clock and stops early once
     * it has spent longer than a step is worth - so on a slow or busy machine
     * it quietly runs fewer steps than the time it was given, and the same
     * shot comes out differently depending on what else the computer was doing.
     * Fixed steps and an explicit cap instead: the table falls behind on a slow
     * device rather than playing out differently on one.
     */
    Table.prototype.step = function (dt) {
        this.events.length = 0;
        dt = Math.min(dt, 0.1);
        if (dt <= 0) return this.events;

        this.carry += dt;
        var n = 0;
        while (this.carry >= FIXED_STEP && n < MAX_SUB_STEPS) {
            this.cannon.step(FIXED_STEP);       // one step, no clock involved
            this.carry -= FIXED_STEP;
            n++;
        }
        // whatever is left over after the cap is time this table will never
        // catch up on; keeping it would only make the next call longer still
        if (this.carry > FIXED_STEP) this.carry = FIXED_STEP;

        this.collect();
        return this.events;
    };

    /** Anything that has fallen below the cloth has been potted. */
    Table.prototype.collect = function () {
        for (var i = 0; i < this.balls.length; i++) {
            var ball = this.balls[i];
            if (!ball.active || ball.body.position.y > -ball.radius * 2) continue;

            ball.active = false;
            ball.stop();
            this.cannon.removeBody(ball.body);
            this.events.push({type: 'pot', ball: ball, pocket: this.nearestPocket(ball)});
        }
    };

    Table.prototype.nearestPocket = function (ball) {
        var best = null, bestD = Infinity;
        for (var i = 0; i < this.pockets.length; i++) {
            var p = this.pockets[i];
            var d = (ball.x - p.x) * (ball.x - p.x) + (ball.y - p.y) * (ball.y - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best;
    };

    /* --------------------------- aiming help -------------------------- */

    /**
     * Where would a ball fired from (x, y) along (dx, dy) first make contact?
     * Plain geometry rather than a physics query: the guide wants the ghost ball
     * position, which is exactly what this gives.
     *
     * @return {?Object} {type: 'ball'|'cushion', x, y, distance, ball, nx, ny}
     */
    Table.prototype.firstContact = function (x, y, dx, dy, ignore) {
        var len = Math.sqrt(dx * dx + dy * dy);
        if (!len) return null;
        dx /= len; dy /= len;

        var r = this.radius, best = null;

        for (var i = 0; i < this.balls.length; i++) {
            var b = this.balls[i];
            if (!b.active || b === ignore) continue;

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
                best = {
                    type: 'ball', x: cx, y: cy, distance: t, ball: b,
                    nx: (b.x - cx) / (2 * r), ny: (b.y - cy) / (2 * r)
                };
            }
        }

        for (var j = 0; j < this.cushions.length; j++) {
            var hit = raySegment(x, y, dx, dy, this.cushions[j], r);
            if (hit && (!best || hit.distance < best.distance)) best = hit;
        }

        return best;
    };

    /* ------------------------------------------------------------------ */

    /** A table with six pockets and the rails gapped to match. */
    Phys.createTable = function (opts) {
        return new Table(opts);
    };

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
        if (denom >= -1e-9) return null;      // travelling away from this rail

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
