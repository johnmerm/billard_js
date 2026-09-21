/**
 * Physics regression tests: node test/phys.test.js
 *
 * These are the properties the game leans on - balls stop, spin does what a
 * player expects, good shots drop, and nothing ever ends up off the cloth.
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
