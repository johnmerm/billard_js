/**
 * Encoder tests: node test/encode.test.js
 *
 * The encoding is the only thing a network ever sees, so its mistakes are not
 * bugs that show up as crashes - they show up as a player that never gets good
 * and no way to tell why. Two properties matter more than the rest: the same
 * table has to look the same to whoever is about to shoot, and ball numbers
 * must not leak, because the 3 and the 5 play identically and a network given
 * the difference will happily learn the rack instead of the game.
 */
var Phys = require('../phys.js');
var Rules = require('../rules.js');
var Encode = require('../train/encode.js');
var Collect = require('../train/collect.js');

var failures = 0;

function check(name, ok, detail) {
    if (ok) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? ' -> ' + detail : ''));
    }
}

function table(balls) {
    var w = Phys.createTable({width: 2.24, height: 1.12});
    balls.forEach(function (b) { w.add(new Phys.Ball(b[0], b[1], b[2])); });
    return w;
}

function same(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false;
    return true;
}

function differences(a, b) {
    var names = Encode.labels(), out = [];
    for (var i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-9) {
            out.push(names[i] + ' ' + a[i].toFixed(3) + '/' + b[i].toFixed(3));
        }
    }
    return out.join(' ');
}

/* ------------------------------------------------------------------ */

console.log('shape');

var w = table([[0, 0.5, 0.5], [1, 1.0, 0.4], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
var pos = {groups: ['solids', 'stripes'], player: 0, open: false};
var v = Encode.encode(w, pos);

check('it is the size it says it is', v.length === Encode.SIZE);
check('every name has a number', Encode.labels().length === Encode.SIZE);
check('nothing is outside nought to one', Array.prototype.every.call(v, function (x) {
    return x >= 0 && x <= 1;
}), Array.prototype.filter.call(v, function (x) { return x < 0 || x > 1; }).join());
check('nothing is a NaN', Array.prototype.every.call(v, function (x) {
    return x === x && isFinite(x);
}));

// a fresh rack puts seven balls of one half into a couple of cells, which is
// where an unbounded count would run away
var Match = require('../train/match.js');
var racked = Match.setup(Match.rng(9));
var rv = Encode.encode(racked, {groups: ['solids', 'stripes'], player: 0, open: false});
check('a full rack stays in range', Array.prototype.every.call(rv, function (x) {
    return x >= 0 && x <= 1;
}), Array.prototype.filter.call(rv, function (x) { return x < 0 || x > 1; }).join());

console.log('it changes nothing');

var before = w.balls.map(function (b) { return b.id + ':' + b.x + ',' + b.y + ':' + b.active; }).join('|');
Encode.encode(w, pos);
check('the table is left as it was',
    w.balls.map(function (b) { return b.id + ':' + b.x + ',' + b.y + ':' + b.active; }).join('|') === before);
check('the same table encodes the same twice', same(Encode.encode(w, pos), v));

console.log('whose table is it');

// the same cloth, seen by each player: what is "mine" swaps, and nothing else
var asZero = Encode.encode(w, {groups: ['solids', 'stripes'], player: 0, open: false});
var asOne = Encode.encode(w, {groups: ['stripes', 'solids'], player: 1, open: false});
check('a player on solids sees what a player on solids sees', same(asZero, asOne),
    differences(asZero, asOne));

var flipped = Encode.encode(w, {groups: ['solids', 'stripes'], player: 1, open: false});
check('and the opponent sees something different', !same(asZero, flipped));

console.log('ball numbers do not leak');

var a = table([[0, 0.5, 0.5], [2, 1.0, 0.4], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
var b = table([[0, 0.5, 0.5], [5, 1.0, 0.4], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
check('swapping one solid for another changes nothing',
    same(Encode.encode(a, pos), Encode.encode(b, pos)),
    differences(Encode.encode(a, pos), Encode.encode(b, pos)));

var c = table([[0, 0.5, 0.5], [11, 1.0, 0.4], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
check('but swapping a solid for a stripe does',
    !same(Encode.encode(a, pos), Encode.encode(c, pos)));

console.log('where the balls are');

var names = Encode.labels();
var corner = table([[0, 2.0, 0.9], [1, 0.05, 0.05], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
var cv = Encode.encode(corner, pos);
check('a solid in the bottom left lights the bottom left of my channel',
    cv[names.indexOf('mine[0,0]')] > 0,
    'got ' + cv[names.indexOf('mine[0,0]')]);
check('and nothing else in that channel',
    Array.prototype.reduce.call(cv.slice(0, Encode.GRID_X * Encode.GRID_Y),
        function (s, x) { return s + x; }, 0) === cv[names.indexOf('mine[0,0]')]);

var stacked = table([[0, 0.5, 0.5], [1, 0.1, 0.1], [2, 0.14, 0.1],
    [9, 1.5, 0.8], [8, 1.8, 0.3]]);
check('two in a cell read heavier than one',
    Encode.encode(stacked, pos)[names.indexOf('mine[0,0]')] >
    cv[names.indexOf('mine[0,0]')]);

console.log('the cue ball');

check('its position is where it is',
    Math.abs(v[names.indexOf('cue.x')] - 0.5 / 2.24) < 1e-6 &&
    Math.abs(v[names.indexOf('cue.y')] - 0.5 / 1.12) < 1e-6);
check('and it is not in hand', v[names.indexOf('cue.inHand')] === 0);

var inHand = table([[0, 0.5, 0.5], [1, 1.0, 0.4], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
inHand.ball(0).lift();
var hv = Encode.encode(inHand, pos);
check('in hand says so', hv[names.indexOf('cue.inHand')] === 1);
check('and there are no pots on until it is put down',
    hv[names.indexOf('shots')] === 0 && hv[names.indexOf('bestCut')] === 0);

console.log('the shape of the game');

check('it counts both halves',
    Math.abs(v[names.indexOf('mineLeft')] - 1 / 7) < 1e-6 &&
    Math.abs(v[names.indexOf('theirsLeft')] - 1 / 7) < 1e-6);

var onEight = table([[0, 0.5, 0.5], [9, 1.5, 0.8], [8, 1.8, 0.3]]);
var ev = Encode.encode(onEight, pos);
check('a cleared half puts you on the 8', ev[names.indexOf('onEight')] === 1);
check('and an uncleared one does not', v[names.indexOf('onEight')] === 0);

var openTable = Encode.encode(w, {groups: [null, null], player: 0, open: true});
check('an open table says so', openTable[names.indexOf('open')] === 1);

console.log('what is on');

var sitter = table([[0, 0.9, 0.35], [1, 0.45, 0.22], [9, 1.9, 0.9], [8, 1.5, 0.6]]);
var sv = Encode.encode(sitter, pos);
check('a pot on the table is reported',
    sv[names.indexOf('shots')] > 0 && sv[names.indexOf('bestCut')] > 0,
    sv[names.indexOf('shots')] + ' shots, cut ' + sv[names.indexOf('bestCut')].toFixed(2));

var walled = table([[0, 0.3, 0.56], [1, 1.9, 0.56], [9, 1.9, 0.2], [8, 1.5, 0.9]]);
for (var k = 2; k < 8; k++) {
    walled.add(new Phys.Ball(k, 1.0, 0.3 + (k - 2) * 2.1 * walled.radius));
}
var wv = Encode.encode(walled, {groups: ['stripes', 'solids'], player: 0, open: false});
check('a snookered player is told there is nothing on',
    wv[names.indexOf('shots')] === 0, String(wv[names.indexOf('shots')]));

console.log('collecting');

var got = Collect.collect(3, 4242, {search: 0, noise: 0.01});
check('it records turns', got.turns > 10, String(got.turns));
check('the rows are the right width',
    got.rows.length === got.turns * Collect.STRIDE);

var labelAt = Encode.SIZE, plyAt = Encode.SIZE + 1;
var labels = [], plies = [];
for (var i = 0; i < got.turns; i++) {
    labels.push(got.rows[i * Collect.STRIDE + labelAt]);
    plies.push(got.rows[i * Collect.STRIDE + plyAt]);
}
check('every turn is won or lost, nothing in between',
    labels.every(function (l) { return l === 1 || l === -1; }));
check('both outcomes turn up',
    labels.indexOf(1) >= 0 && labels.indexOf(-1) >= 0);
check('the last turn of a rack is one ply from the end',
    Math.min.apply(null, plies) === 1, String(Math.min.apply(null, plies)));
check('the features are the encoder’s, not something else',
    Array.prototype.every.call(got.rows.slice(0, Encode.SIZE), function (x) {
        return x >= 0 && x <= 1;
    }));

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
