/**
 * Physics regression tests: node test/phys.test.js
 *
 * phys.js drives cannon.js, and cannon.js runs in node, so the whole table can
 * be played here with no browser. These are the properties the game leans on -
 * balls stop, spin does what a player expects, good shots drop, and a hard
 * break leaves the rack on the cloth.
 */
var Phys = require('../phys.js');

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

/** Run until everything stops, returning the events seen on the way. */
function settle(world, limit) {
    var t = 0, seen = [];
    while (!world.atRest() && t < (limit || 60)) {
        seen = seen.concat(world.step(1 / 240));
        t += 1 / 240;
    }
    return {time: t, events: seen, rested: world.atRest()};
}

function potted(result) {
    return result.events.filter(function (e) { return e.type === 'pot'; })
        .map(function (e) { return e.ball.id; });
}

/* ------------------------------------------------------------------ */

console.log('engine');

check('cannon.js is doing the simulation', !!Phys.CANNON && !!Phys.CANNON.World,
    'no cannon.js');
(function () {
    var w = table();
    check('the table is a cannon world with bodies in it',
        w.cannon instanceof Phys.CANNON.World && w.cannon.bodies.length > 1,
        w.cannon ? w.cannon.bodies.length + ' bodies' : 'no world');
})();

console.log('rest and friction');

(function () {
    var w = table();
    var b = w.add(new Phys.Ball(0, 0.4, 0.56));
    w.strike(b, 1, 0.06, 2.5, 0, 0);          // down the table, away from any pocket
    var r = settle(w, 90);
    check('a struck ball comes to rest', r.rested, 'still rolling after ' + r.time.toFixed(1) + 's');
    check('it stays on the table', b.active);
    check('and it rolls for a few seconds', r.time > 1.5 && r.time < 30, r.time.toFixed(2) + 's');
})();

/*
 * A ball turning on the spot is going nowhere, so it deliberately does not hold
 * play up - but it does have to stop turning, and be seen to. Left to the
 * rolling decay a cue ball hit with english is still spinning at a quarter turn
 * a second when the table calls itself at rest, and takes another six seconds to
 * become invisible without ever quite reaching nothing. On a table where the
 * balls are drawn and nothing else is moving, that reads as a bug.
 */
(function () {
    var w = table();
    var cue = w.add(new Phys.Ball(0, 0.5, 0.56));
    w.add(new Phys.Ball(1, 1.2, 0.56));
    w.strike(cue, 1, 0, 3.0, 0.7, 0, 0);        // as much side spin as the cue gives
    settle(w, 60);

    function english() {
        return Math.max.apply(null, w.balls.filter(function (b) { return b.active; })
            .map(function (b) { return Math.abs(b.body.angularVelocity.y); }));
    }

    check('a table at rest is nearly done turning', english() < 0.2,
        english().toFixed(3) + ' rad/s left');

    for (var k = 0; k < 240; k++) w.step(1 / 120);      // two more seconds
    check('and a second later nothing is turning at all', english() === 0,
        english().toFixed(6) + ' rad/s left');
})();

console.log('spin');

(function () {
    function cueAfter(vert) {
        var w = table();
        var cue = w.add(new Phys.Ball(0, 0.5, 0.56));
        w.add(new Phys.Ball(1, 1.0, 0.56));
        w.strike(cue, 1, 0, 2.2, 0, vert);

        // let the collision happen, then watch the cue ball for a second while
        // the object ball is still rolling away from it
        var t = 0, hit = 0;
        while (t < 3 && (!hit || t - hit < 1.0)) {
            w.step(1 / 480).forEach(function (e) { if (e.type === 'ballHit' && !hit) hit = t; });
            t += 1 / 480;
        }
        return cue.x;
    }

    var draw = cueAfter(-0.6), stun = cueAfter(0), follow = cueAfter(0.6);
    check('draw pulls the cue ball back', draw < stun - 0.02,
        'draw ' + draw.toFixed(3) + ' vs stun ' + stun.toFixed(3));
    check('follow sends it forward', follow > stun + 0.02,
        'follow ' + follow.toFixed(3) + ' vs stun ' + stun.toFixed(3));
})();

(function () {
    // straight into a cushion: without english the ball returns along its own
    // line, with english it comes off to one side
    function offCushion(side) {
        var w = table();
        var b = w.add(new Phys.Ball(0, 0.7, 0.3));   // clear of the side pocket
        w.strike(b, 0, -1, 2.0, side, 0);
        var t = 0, bounced = false;
        while (t < 1.5 && !(bounced && t > 0.35)) {
            w.step(1 / 480).forEach(function (e) { if (e.type === 'cushion') bounced = true; });
            t += 1 / 480;
        }
        return b.x - 0.7;
    }

    var straight = Math.abs(offCushion(0));
    var spun = Math.abs(offCushion(0.6));
    check('no english comes straight back off the cushion', straight < 0.01, straight.toFixed(4));
    check('side english throws the ball off line', spun > straight + 0.01, spun.toFixed(4));
})();

console.log('the cloth, which is where draw and follow live');

(function () {
    // A ball struck low slides with backspin for the best part of a second
    // before it rolls. If that transition is rushed, draw stops working.
    var w = table();
    var b = w.add(new Phys.Ball(0, 0.35, 0.56));
    w.strike(b, 1, 0, 2.5, 0, -0.6);

    var t = 0, rolled = -1;
    while (t < 3 && b.x < 2.0) {
        w.step(1 / 480);
        t += 1 / 480;
        var slip = b.body.velocity.x + b.body.angularVelocity.z * b.radius;
        if (rolled < 0 && Math.abs(slip) < 0.02) rolled = t;
    }
    check('a sliding ball takes about a second to start rolling',
        rolled > 0.5 && rolled < 1.4, rolled.toFixed(2) + 's');
})();

(function () {
    // close enough that the spin has not yet turned into rolling
    function cueAfter(vert) {
        var w = table();
        var cue = w.add(new Phys.Ball(0, 0.75, 0.56));
        var obj = w.add(new Phys.Ball(1, 1.0, 0.56));
        w.strike(cue, 1, 0, 2.5, 0, vert);

        var t = 0, hit = 0, at = 0;
        while (t < 3) {
            w.step(1 / 480);
            t += 1 / 480;
            if (!hit && obj.speed() > 0.01) { hit = t; at = cue.x; }
            if (hit && t - hit > 0.5) break;
        }
        return cue.x - at;
    }

    var draw = cueAfter(-0.6), stun = cueAfter(0), follow = cueAfter(0.6);
    check('draw brings the cue ball back off the object ball', draw < -0.1,
        (draw * 100).toFixed(1) + ' cm');
    check('follow sends it through', follow > 0.1, (follow * 100).toFixed(1) + ' cm');
    check('and a centre ball hit does neither', Math.abs(stun) < 0.1,
        (stun * 100).toFixed(1) + ' cm');
})();

(function () {
    // a near frictionless contact cannot hand over spin: the object ball should
    // leave a full ball hit barely turning at all
    var w = table();
    var cue = w.add(new Phys.Ball(0, 0.5, 0.56));
    var obj = w.add(new Phys.Ball(1, 1.0, 0.56));
    w.strike(cue, 1, 0, 2.5, 0, 0.55);

    var t = 0, cueSpinIn = 0, cueSpinOut = null, objSpin = null;
    while (t < 2) {
        if (objSpin === null) cueSpinIn = -cue.body.angularVelocity.z;
        w.step(1 / 480);
        t += 1 / 480;
        if (objSpin === null && obj.speed() > 0.01) {
            objSpin = -obj.body.angularVelocity.z;
            cueSpinOut = -cue.body.angularVelocity.z;
        }
    }
    check('the cue ball carries its spin through the collision',
        cueSpinOut > 0.8 * cueSpinIn, cueSpinIn.toFixed(0) + ' -> ' + cueSpinOut.toFixed(0) + ' rad/s');
    check('and the object ball leaves it hardly spinning',
        Math.abs(objSpin) < 0.15 * cueSpinIn, objSpin.toFixed(0) + ' rad/s');
})();

console.log('pocketing');

(function () {
    var r = new Phys.Ball(0, 0, 0).radius;

    for (var i = 0; i < 6; i++) {
        var w = table();
        var p = w.pockets[i];
        // put the object ball a good distance out on the line to this pocket
        var toCentre = {x: 1.12 - p.x, y: 0.56 - p.y};
        var len = Math.hypot(toCentre.x, toCentre.y);
        var ox = p.x + toCentre.x / len * 0.55, oy = p.y + toCentre.y / len * 0.55;

        var dx = (p.x - ox) / 0.55, dy = (p.y - oy) / 0.55;
        var cue = w.add(new Phys.Ball(0, ox - dx * (2 * r + 0.4), oy - dy * (2 * r + 0.4)));
        w.add(new Phys.Ball(1, ox, oy));
        w.strike(cue, dx, dy, 2.2, 0, 0);

        var res = settle(w, 60);
        check('pocket ' + i + ' accepts a straight shot', potted(res).indexOf(1) >= 0,
            'potted ' + JSON.stringify(potted(res)));
    }
})();

console.log('jump shots');

(function () {
    var w = table();
    var cue = w.add(new Phys.Ball(0, 0.5, 0.56));
    var blocker = w.add(new Phys.Ball(1, 0.78, 0.56));
    var target = w.add(new Phys.Ball(2, 1.15, 0.56));

    w.strike(cue, 1, 0, 4.5, 0, 0, 55 * Math.PI / 180);

    var t = 0, peak = 0, hitBlocker = false, hitTarget = false, blockerAsPassed = null;
    while (t < 3 && !hitTarget) {
        w.step(1 / 480).forEach(function (e) {
            if (e.type !== 'ballHit') return;
            if (e.a.id !== 0 && e.b.id !== 0) return;
            var other = e.a.id === 0 ? e.b : e.a;
            if (other.id === 1) hitBlocker = true;
            if (other.id === 2 && !hitBlocker) hitTarget = true;
        });
        t += 1 / 480;
        peak = Math.max(peak, cue.height - cue.radius);
        // where the ball in the way stood as the cue ball went over it
        if (blockerAsPassed === null && cue.x > 0.78) blockerAsPassed = blocker.x;
    }

    check('a raised cue lifts the ball over another', peak > cue.radius * 2,
        (peak * 1000).toFixed(0) + ' mm, needs ' + (cue.radius * 2000).toFixed(0));
    check('it clears the ball in the way', !hitBlocker);
    check('and lands on the one behind it', hitTarget);
    check('the ball it jumped never moved', Math.abs(blockerAsPassed - 0.78) < 0.001,
        blockerAsPassed === null ? 'never got past it' : blockerAsPassed.toFixed(4));
})();

(function () {
    // a level cue must still not jump
    var w = table();
    var cue = w.add(new Phys.Ball(0, 0.5, 0.56));
    w.strike(cue, 1, 0, 6, 0, 0.5, 0);
    var t = 0, peak = 0;
    // just the run down the table, before any cushion gets involved
    while (t < 0.25) { w.step(1 / 480); t += 1 / 480; peak = Math.max(peak, cue.height - cue.radius); }
    check('a level cue keeps the ball on the cloth', peak < 0.005,
        (peak * 1000).toFixed(1) + ' mm');
})();

console.log('balls stay on the cloth');

(function () {
    // heavy topspin straight into a cushion: friction against a flat box face
    // used to climb it and launch the ball off the end of the table
    var w = table();
    var b = w.add(new Phys.Ball(0, 1.9, 0.56));
    w.strike(b, 1, 0, 9, 0, 0.7);

    var t = 0, highest = 0;
    while (t < 2 && b.active) {
        w.step(1 / 480);
        t += 1 / 480;
        highest = Math.max(highest, b.height - b.radius);
    }
    check('a rail does not launch a ball with heavy top', highest < 0.02,
        (highest * 1000).toFixed(1) + ' mm of air');
    check('and the ball is still on the table', b.active);
})();

console.log('pockets are holes, not trigger zones');

(function () {
    var w = table();
    var b = w.add(new Phys.Ball(0, 1.12, 0.3));
    w.strike(b, 0, -1, 1.6, 0, 0);            // straight at a side pocket

    var dropped = false, pots = [], t = 0;
    while (t < 6 && !pots.length) {
        w.step(1 / 240).forEach(function (e) { if (e.type === 'pot') pots.push(e); });
        t += 1 / 240;
        if (b.height < -b.radius) dropped = true;
    }

    check('a ball that crosses a pocket mouth falls off the cloth', dropped,
        'height ' + b.height.toFixed(3));
    check('and is reported potted, in the pocket it fell into',
        pots.length === 1 && pots[0].ball === b && !b.active &&
        Math.abs(pots[0].pocket.x - 1.12) < 0.05,
        pots.length ? JSON.stringify(pots[0].pocket) : 'no pot event');
})();

console.log('a full break');

(function () {
    var w = table();
    var r = w.radius, gap = 2 * r * 1.02, foot = 2.24 * 0.72;
    for (var id = 0; id < 16; id++) w.add(new Phys.Ball(id, 0, 0));
    var n = 1;
    for (var row = 0; row < 5; row++) {
        for (var j = 0; j <= row; j++) {
            w.ball(n++).placeAt(foot + row * gap * 0.866, 0.56 + (j - row / 2) * gap);
        }
    }
    w.ball(0).placeAt(0.5, 0.56);
    w.strike(w.ball(0), 1, 0.02, 8, 0, 0.2);

    var res = settle(w, 120);
    check('the rack settles', res.rested, 'still moving after ' + res.time.toFixed(1) + 's');

    var off = w.balls.filter(function (b) {
        return b.active && (b.x < 0 || b.x > 2.24 || b.y < 0 || b.y > 1.12);
    });
    check('no ball is left off the cloth', off.length === 0,
        off.map(function (b) { return b.id; }).join(','));

    var overlaps = 0;
    for (var i = 0; i < w.balls.length; i++) {
        for (var k = i + 1; k < w.balls.length; k++) {
            var a = w.balls[i], b = w.balls[k];
            if (!a.active || !b.active) continue;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 2 * r - 1e-4) overlaps++;
        }
    }
    check('no balls are overlapping', overlaps === 0, overlaps + ' pairs');
    check('the break scatters the rack', res.events.filter(function (e) {
        return e.type === 'ballHit';
    }).length > 20);
})();

console.log('collisions');

(function () {
    var w = table();
    var a = w.add(new Phys.Ball(0, 0.6, 0.56));
    var b = w.add(new Phys.Ball(1, 1.0, 0.56));
    w.strike(a, 1, 0, 2.0, 0, 0);

    var before = a.speed(), t = 0, hit = false;
    while (t < 0.6 && !hit) {
        before = a.speed();                   // speed carried into the collision
        w.step(1 / 480).forEach(function (e) { if (e.type === 'ballHit') hit = true; });
        t += 1 / 480;
    }
    var after = a.speed() + b.speed();
    check('momentum is not created out of nothing', after <= before + 1e-6,
        after.toFixed(3) + ' vs ' + before.toFixed(3));
    check('most of the speed passes to the object ball', b.speed() > 0.85 * before,
        b.speed().toFixed(3));
})();

console.log(failures ? '\n' + failures + ' failing check(s)' : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
