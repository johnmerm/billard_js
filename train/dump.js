#!/usr/bin/env node
/**
 * train/dump.js - positions and features as json, for anything outside node.
 *
 *   node train/dump.js turns --games 40 --seed 7        labelled turns
 *   node train/dump.js sweep --seed 12 --at 6           one position, cue ball moved about
 *   node train/dump.js predict --file features.json     the same numbers through tfjs
 *
 * The encoder, the rules and the simulator are javascript and they are the
 * only definition of what a position looks like to the network. Rewriting any
 * of that somewhere else to look at it - in a notebook, say - would mean two
 * definitions, and the day they drift the network is being shown positions
 * nobody trained it on. So this writes json and whatever is reading can stay
 * ignorant of billiards.
 *
 * Everything here runs on the repo alone: no tensorflow, no npm, except for
 * `predict`, which exists precisely to check an outside forward pass against
 * the real one.
 */
var Phys = require('../phys.js');
var Rules = require('../rules.js');
var Match = require('./match.js');
var Bot = require('./bot.js');
var Encode = require('./encode.js');
var Collect = require('./collect.js');

function arg(name, fallback) {
    var i = process.argv.indexOf('--' + name);
    if (i < 0) return fallback;
    var next = process.argv[i + 1];
    return (next === undefined || next.slice(0, 2) === '--') ? true : next;
}

function say(obj) { process.stdout.write(JSON.stringify(obj)); }

/** Round-trip safe enough for json and far easier to read. */
function round(v, places) {
    var f = Math.pow(10, places === undefined ? 4 : places);
    return Math.round(v * f) / f;
}

/* ------------------------------------------------------------------ *
 * turns: the training set, in the small
 * ------------------------------------------------------------------ */

/**
 * Play racks and hand back every turn in them, encoded and labelled - the
 * same rows `collect.js` writes to a shard, in json rather than raw floats.
 */
function turns() {
    var games = +arg('games', 40);
    var seed = +arg('seed', 1);
    var search = +arg('search', 4);

    var got = Collect.collect(games, seed, {search: search});
    var stride = Collect.STRIDE;
    var rows = [];
    for (var i = 0; i < got.turns; i++) {
        var at = i * stride;
        var x = [];
        for (var k = 0; k < Encode.SIZE; k++) x.push(round(got.rows[at + k]));
        rows.push({x: x, label: got.rows[at + Encode.SIZE],
            ply: got.rows[at + Encode.SIZE + 1]});
    }

    say({labels: Encode.labels(), size: Encode.SIZE, games: games, seed: seed,
        racks: got.finished, drawn: got.drawn, rows: rows});
}

/* ------------------------------------------------------------------ *
 * sweep: one position, with the cue ball moved everywhere legal
 * ------------------------------------------------------------------ */

/** The table as plain numbers: enough to draw it and to rebuild it. */
function snapshot(world, pos) {
    return {
        width: world.width, height: world.height, radius: world.radius,
        pockets: world.pockets.map(function (p) {
            return {x: p.x, y: p.y, radius: p.radius, corner: !!p.corner};
        }),
        balls: world.balls.filter(function (b) { return b.active; })
            .map(function (b) {
                return {id: b.id, x: round(b.x, 5), y: round(b.y, 5),
                    group: Rules.groupOf(b.id)};
            }),
        groups: pos.groups.slice(), player: pos.player, open: pos.open
    };
}

/** Put a snapshot back on a table of its own. */
function rebuild(snap) {
    var world = Phys.createTable({width: snap.width, height: snap.height});
    snap.balls.forEach(function (b) {
        world.add(new Phys.Ball(b.id, b.x, b.y));
    });
    return world;
}

/**
 * Stop a rack partway through and describe the table there, then encode the
 * same position once per cue ball spot on a grid.
 *
 * This is the question the player actually asks - "what would this table be
 * worth with the cue ball there?" - asked everywhere at once instead of at
 * the two or three places a shot could leave it.
 */
function sweep() {
    var seed = +arg('seed', 12);
    var at = +arg('at', 6);                  // which turn to stop on
    var steps = +arg('steps', 40);           // grid across the long side

    var held = null;
    Match.playGame([
        Bot.create({search: 4, seed: seed * 7919}),
        Bot.create({search: 4, seed: seed * 104729})
    ], {
        seed: seed,
        observe: function (world, pos, n) {
            if (n === at && !pos.ballInHand) held = snapshot(world, pos);
        }
    });
    if (!held) {
        say({error: 'rack ' + seed + ' had no turn ' + at + ' with a ball on the table'});
        return;
    }

    var world = rebuild(held);
    var cue = world.ball(0);
    var pos = {groups: held.groups, player: held.player, open: held.open};

    var down = Math.max(2, Math.round(steps * held.height / held.width));
    var cells = [];
    for (var j = 0; j < down; j++) {
        for (var i = 0; i < steps; i++) {
            var x = (i + 0.5) / steps * held.width;
            var y = (j + 0.5) / down * held.height;
            if (!Rules.placementLegal(world, x, y, false)) {
                cells.push({i: i, j: j, x: round(x, 4), y: round(y, 4), legal: false});
                continue;
            }
            cue.placeAt(x, y);
            var f = Encode.encode(world, pos);
            var xs = [];
            for (var k = 0; k < Encode.SIZE; k++) xs.push(round(f[k]));
            cells.push({i: i, j: j, x: round(x, 4), y: round(y, 4), legal: true, x_: xs});
        }
    }

    say({table: held, labels: Encode.labels(), across: steps, down: down,
        turn: at, seed: seed, cells: cells});
}

/* ------------------------------------------------------------------ *
 * predict: the real forward pass, for checking an imitation of it
 * ------------------------------------------------------------------ */

function predict() {
    var fs = require('fs');
    var file = String(arg('file', ''));
    var dir = String(arg('model', 'model/value'));
    var rows = JSON.parse(fs.readFileSync(file, 'utf8'));

    require('./value.js').loadModel(dir).then(function (model) {
        var tf = require('@tensorflow/tfjs');
        var flat = new Float32Array(rows.length * Encode.SIZE);
        rows.forEach(function (r, i) { flat.set(Float32Array.from(r), i * Encode.SIZE); });
        var out = model.predict(tf.tensor2d(flat, [rows.length, Encode.SIZE])).dataSync();
        say({values: Array.prototype.slice.call(out)});
    }).catch(function (err) {
        say({error: err.message});
    });
}

/* ------------------------------------------------------------------ */

var what = process.argv[2];
if (what === 'turns') turns();
else if (what === 'sweep') sweep();
else if (what === 'predict') predict();
else {
    process.stderr.write('usage: dump.js turns|sweep|predict [options]\n');
    process.exit(2);
}
