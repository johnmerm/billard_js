/**
 * Flat renderer tests: node test/render2d.test.js
 *
 * render2d.js is what the game falls back to when WebGL will not start. It only
 * needs a 2d canvas, so a recording stub stands in for one here and the whole
 * thing runs without a browser. What matters is the mapping between the cloth
 * and the screen - a shot is aimed by pointing at the table, and a pointer that
 * lands in the wrong place makes the game unplayable - and that nothing throws
 * on the awkward states: a ball in a pocket, a ball in the air, a raised cue.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
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

function near(a, b, tol) {
    return Math.abs(a - b) < (tol === undefined ? 1e-6 : tol);
}

/* ------------------------- a canvas that only remembers ------------------- */

function stubContext() {
    var calls = [];
    var ctx = {};
    ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
        'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'fillText',
        'strokeText', 'setTransform'].forEach(function (name) {
        ctx[name] = function () {
            calls.push(name);
            return undefined;
        };
    });
    ctx.createRadialGradient = function () {
        return {addColorStop: function () { /* recorded by its fill */ }};
    };
    ctx.calls = calls;
    return ctx;
}

function stubCanvas(w, h) {
    var ctx = stubContext();
    return {
        clientWidth: w, clientHeight: h, width: 0, height: 0,
        getContext: function () { return ctx; },
        getBoundingClientRect: function () {
            return {left: 0, top: 0, width: w, height: h};
        },
        ctx: ctx
    };
}

/** render2d.js is a browser script, so it is loaded into a stubbed window. */
function load() {
    var src = fs.readFileSync(path.join(__dirname, '..', 'render2d.js'), 'utf8');
    var sandbox = {
        window: {devicePixelRatio: 1},
        BallSkins: {color: function () { return '#ffffff'; }},
        Math: Math, Error: Error
    };
    vm.createContext(sandbox);
    vm.runInContext(src + '\nthis.Renderer2D = Renderer2D;', sandbox);
    return sandbox.Renderer2D;
}

var Renderer2D = load();

/** A table with a full rack on it, the way the game sets one up. */
function table() {
    var w = Phys.createTable({width: 2.24, height: 1.12});
    w.add(new Phys.Ball(0, w.width * 0.22, w.height / 2));

    var gap = w.radius * 2.06, foot = w.width * 0.72, n = 1;
    for (var row = 0; row < 5; row++) {
        for (var j = 0; j <= row; j++) {
            w.add(new Phys.Ball(n++, foot + row * gap * 0.866,
                w.height / 2 + (j - row / 2) * gap));
        }
    }
    return w;
}

/* ------------------------------------------------------------------ */

console.log('panes');

var world = table();
var canvas = stubCanvas(1200, 800);
var view = new Renderer2D(canvas, world);

check('it announces itself as the flat renderer', view.flat === true);
check('it offers the same calls the game makes',
    ['render', 'syncBalls', 'setAim', 'setInHand', 'setSplit', 'setPaneRegion',
        'swapViews', 'screenToTable', 'getSplit', 'setTableInsets']
        .every(function (name) { return typeof view[name] === 'function'; }));

view.setPaneRegion(90, 110);
var rects = view.render(world.ball(0), 0);

check('the table pane clears the bands the panels sit in',
    rects.table.y === 90 && rects.table.h === 800 - 90 - 110,
    JSON.stringify(rects.table));
check('a landscape window puts the two panes side by side',
    rects.pov.w > 0 && rects.table.y === rects.pov.y && rects.table.x < rects.pov.x &&
    rects.seam.vertical === true,
    JSON.stringify(rects));
check('the panes do not overlap',
    rects.table.x + rects.table.w <= rects.pov.x &&
    rects.table.x + rects.table.w + rects.seam.w <= rects.pov.x + 1);
check('the seam sits in the gap between them',
    rects.seam.x >= rects.table.x + rects.table.w &&
    rects.seam.x + rects.seam.w <= rects.pov.x + 1);
check('swapping puts the table in the other pane', (function () {
    var before = rects.table.x;
    view.swapViews();
    var after = view.render(world.ball(0), 0);
    var moved = after.table.x !== before && after.pov.x === before;
    view.swapViews();
    rects = view.render(world.ball(0), 0);      // back the way it was
    return moved && view.isSwapped() === false;
})());
check('the backing store follows the device pixel ratio',
    canvas.width === 1200 && canvas.height === 800);

console.log('pointing at the cloth');

function pick(v, r, u, t) {           // u, t in 0..1 across and down the pane
    return v.screenToTable(r.table.x + r.table.w * u, r.table.y + r.table.h * t, r);
}

var mid = pick(view, rects, 0.5, 0.5);
check('the middle of the pane is the middle of the table',
    near(mid.x, world.width / 2, 1e-9) && near(mid.y, world.height / 2, 1e-9),
    JSON.stringify(mid));

var right = pick(view, rects, 0.8, 0.5);
var up = pick(view, rects, 0.5, 0.2);
check('landscape: screen right is table +x', right.x > mid.x && near(right.y, mid.y, 1e-9));
check('landscape: screen up is table +y', up.y > mid.y && near(up.x, mid.x, 1e-9));

check('a pointer off the pane picks nothing',
    view.screenToTable(600, 10, rects) === null);

// the round trip has to land back where it started, or aiming drifts
var probes = [[0.2, 0.3], [1.9, 0.9], [0.0, 0.0], [2.24, 1.12]];
var landscapeOk = probes.every(function (p) {
    // walk a table point out to the screen through the pane, and back
    var u = null;
    for (var i = 0; i <= 200; i++) {
        var got = pick(view, rects, i / 200, 0.5);
        if (got && Math.abs(got.x - p[0]) < 0.02) { u = i / 200; break; }
    }
    if (u === null) return false;
    var back = pick(view, rects, u, 0.5);
    return Math.abs(back.x - p[0]) < 0.02;
});
check('a point picked off the screen comes back the same', landscapeOk);

console.log('standing the table on end');

var tall = stubCanvas(520, 900);
var portrait = new Renderer2D(tall, world);
var prects = portrait.render(world.ball(0), 0);

var pmid = pick(portrait, prects, 0.5, 0.5);
check('portrait: the middle of the pane is still the middle of the table',
    near(pmid.x, world.width / 2, 1e-9) && near(pmid.y, world.height / 2, 1e-9),
    JSON.stringify(pmid));

var pup = pick(portrait, prects, 0.5, 0.2);
var pleft = pick(portrait, prects, 0.2, 0.5);
check('portrait: screen up is table +x', pup.x > pmid.x && near(pup.y, pmid.y, 1e-9));
check('portrait: screen left is table +y', pleft.y > pmid.y && near(pleft.x, pmid.x, 1e-9));

/** The stretch of cloth a pane is showing, in table coordinates. */
function covered(v, r) {
    var xs = [], ys = [];
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (c) {
        var p = pick(v, r, c[0] === 0 ? 0.001 : 0.999, c[1] === 0 ? 0.001 : 0.999);
        xs.push(p.x);
        ys.push(p.y);
    });
    return {
        x1: Math.min.apply(null, xs), x2: Math.max.apply(null, xs),
        y1: Math.min.apply(null, ys), y2: Math.max.apply(null, ys)
    };
}

function holdsTheTable(box, w) {
    return box.x1 <= 0 && box.x2 >= w.width && box.y1 <= 0 && box.y2 >= w.height;
}

check('landscape shows the whole table', holdsTheTable(covered(view, rects), world),
    JSON.stringify(covered(view, rects)));
check('portrait shows the whole table', holdsTheTable(covered(portrait, prects), world),
    JSON.stringify(covered(portrait, prects)));

console.log('the awkward states');

var w2 = table();
var cv2 = stubCanvas(1000, 700);
var v2 = new Renderer2D(cv2, w2);

function draws(name, prepare) {
    var before = cv2.ctx.calls.length;
    try {
        prepare();
        v2.syncBalls();
        v2.render(w2.ball(0), 0);
        check(name, cv2.ctx.calls.length > before);
    } catch (err) {
        check(name, false, err.message);
    }
}

draws('a plain rack draws', function () { /* straight out of the rack */ });

draws('an aimed cue draws', function () {
    v2.setAim({ball: w2.ball(0), angle: 0.3, power: 0.6, side: 0.4, vert: -0.5,
        elevation: 0});
});

draws('a raised cue draws', function () {
    v2.setAim({ball: w2.ball(0), angle: 0.3, power: 1, side: 0, vert: 0,
        elevation: 45 * Math.PI / 180});
});

draws('a cue standing straight up draws', function () {
    v2.setAim({ball: w2.ball(0), angle: 0, power: 0, side: 0, vert: 0,
        elevation: Math.PI / 2});
});

draws('a ball in the air draws', function () {
    w2.ball(3).body.position.y = w2.radius * 6;
});

draws('a potted ball draws', function () {
    w2.ball(4).active = false;
    w2.ball(5).body.position.y = -w2.radius * 4;
});

draws('the ball in hand marker draws', function () {
    v2.setAim(null);
    v2.setInHand({x: 0.5, y: 0.6, legal: false});
});

draws('nothing to aim at draws', function () {
    v2.setInHand(null);
    w2.balls.forEach(function (b) { if (b.id !== 0) b.active = false; });
    v2.setAim({ball: w2.ball(0), angle: 1.2, power: 0.2, side: 0, vert: 0, elevation: 0});
});

console.log('the cue ball pane');

/**
 * Each pane clips to its own rectangle, so the calls after the second `clip`
 * are the cue ball view's. That is enough to tell whether the guides reached
 * it: an open line whose far end went missing drew nothing at all.
 */
function povCalls(v, prepare) {
    var cv = stubCanvas(1000, 700);
    var r = new Renderer2D(cv, v);
    r.setPaneRegion(0, 0);
    prepare(r);
    cv.ctx.calls.length = 0;
    r.render(v.ball(0), 0.4);

    var clips = 0, from = -1;
    cv.ctx.calls.forEach(function (name, i) {
        if (name === 'clip' && ++clips === 2) from = i;
    });
    if (from < 0) return null;
    return cv.ctx.calls.slice(from).filter(function (name) {
        return name === 'lineTo';
    }).length;
}

var w3 = table();
var quiet = povCalls(w3, function (r) { r.setAim(null); });
var aimed = povCalls(w3, function (r) {
    r.setAim({ball: w3.ball(0), angle: 0.4, power: 0.5, side: 0, vert: 0, elevation: 0});
});

// a raised cue is aiming over whatever is in the way, so the contact ring goes
// and the aim line is the only thing left - which is what isolates it
var jumping = povCalls(w3, function (r) {
    r.setAim({ball: w3.ball(0), angle: 0.4, power: 1, side: 0, vert: 0,
        elevation: 45 * Math.PI / 180});
});

check('the cue ball view is drawn at all', quiet !== null && quiet > 0, String(quiet));
check('the aim line reaches the cue ball view', jumping > quiet,
    'without an aim ' + quiet + ', with one ' + jumping);
check('so does the contact ring, and a jump shot drops it',
    aimed > jumping, 'jumping ' + jumping + ', level ' + aimed);

console.log('the split the page remembers');

check('a split is clamped and handed back', v2.setSplit(0.95) === 0.8 &&
    v2.setSplit(0.05) === 0.2 && v2.setSplit(0.5) === 0.5 && v2.getSplit() === 0.5);

check('the split decides how much of the window the table pane gets', (function () {
    var wide = new Renderer2D(stubCanvas(1200, 800), world);
    wide.setSplit(0.3);
    var narrow = wide.render(world.ball(0), 0).table.w;
    wide.setSplit(0.7);
    return wide.render(world.ball(0), 0).table.w > narrow;
})());

check('a tall window stacks the panes instead', (function () {
    var r = new Renderer2D(stubCanvas(420, 900), world).render(world.ball(0), 0);
    return r.table.x === r.pov.x && r.table.y < r.pov.y &&
        r.seam.vertical === false &&
        r.table.y + r.table.h <= r.pov.y;
})());

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
