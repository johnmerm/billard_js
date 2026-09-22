#!/usr/bin/env node
/**
 * train/value.js - learn to judge a position.
 *
 *   node train/value.js --data data/v1 --out model/value
 *
 * One question, asked of every turn in the self play data: you are about to
 * shoot, here is the table - how often does this end with you winning? The
 * answer is a number between -1 and 1, and it is the whole of what the player
 * learns. Which shot to play is then a search: try the pots the geometry
 * offers, simulate each one, and keep whichever leaves the opponent the
 * position this network likes least.
 *
 * The split is by rack, not by turn. Every turn in a rack carries the same
 * outcome and they are all much alike, so splitting by turn would put near
 * copies of the same position on both sides of the fence and report a score
 * that means nothing.
 */
var fs = require('fs');
var path = require('path');
var tf = require('@tensorflow/tfjs');
var Encode = require('./encode.js');

var STRIDE = Encode.SIZE + 2;
var LABEL = Encode.SIZE, PLY = Encode.SIZE + 1;

function arg(name, fallback) {
    var i = process.argv.indexOf('--' + name);
    if (i < 0) return fallback;
    var next = process.argv[i + 1];
    return (next === undefined || next.slice(0, 2) === '--') ? true : next;
}

/* ----------------------------- the data --------------------------- */

/**
 * Every shard in one or more directories, as a single flat array of rows.
 *
 * More than one because a round of training is usually best done on the round
 * that produced it *and* the ones before: the older games are worse, but they
 * visit positions the current player has learned to steer around and would
 * otherwise never see again.
 */
function load(dirs) {
    if (typeof dirs === 'string') dirs = dirs.split(',');

    var parts = [], metas = [];
    dirs.forEach(function (dir) {
        dir = dir.trim();
        var meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        if (meta.encoder !== Encode.VERSION) {
            throw new Error(dir + ' was written by encoder v' + meta.encoder +
                ', this is v' + Encode.VERSION + ' - collect it again');
        }
        metas.push({dir: dir, turns: meta.turns, racks: meta.racks,
            player: meta.player || 'baseline bot'});
        meta.shards.forEach(function (name) {
            var buf = fs.readFileSync(path.join(dir, name));
            parts.push(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
        });
    });

    var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
    var rows = new Float32Array(total);
    var at = 0;
    parts.forEach(function (p) { rows.set(p, at); at += p.length; });
    return {rows: rows, count: total / STRIDE, sources: metas};
}

/**
 * Where each rack starts. Within a rack the ply counts down to one, so a row
 * whose ply is not one less than the row before it begins a new one.
 */
function rackStarts(data) {
    var starts = [];
    for (var i = 0; i < data.count; i++) {
        var ply = data.rows[i * STRIDE + PLY];
        if (i === 0 || ply !== data.rows[(i - 1) * STRIDE + PLY] - 1) starts.push(i);
    }
    return starts;
}

/** Split whole racks into training and validation. */
function split(data, fraction, seed) {
    var starts = rackStarts(data);
    var ends = starts.slice(1).concat([data.count]);

    var order = starts.map(function (s, i) { return i; });
    var x = seed || 12345;
    for (var i = order.length - 1; i > 0; i--) {          // seeded shuffle
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        var j = x % (i + 1);
        var t = order[i]; order[i] = order[j]; order[j] = t;
    }

    var cut = Math.floor(order.length * (1 - fraction));
    function gather(which) {
        var rows = [];
        which.forEach(function (r) {
            for (var k = starts[r]; k < ends[r]; k++) rows.push(k);
        });
        return rows;
    }
    return {
        train: gather(order.slice(0, cut)),
        valid: gather(order.slice(cut)),
        racks: order.length
    };
}

/** Rows to tensors. */
function tensors(data, rows) {
    var xs = new Float32Array(rows.length * Encode.SIZE);
    var ys = new Float32Array(rows.length);
    rows.forEach(function (r, i) {
        for (var k = 0; k < Encode.SIZE; k++) xs[i * Encode.SIZE + k] = data.rows[r * STRIDE + k];
        ys[i] = data.rows[r * STRIDE + LABEL];
    });
    return {
        x: tf.tensor2d(xs, [rows.length, Encode.SIZE]),
        y: tf.tensor2d(ys, [rows.length, 1])
    };
}

/* ---------------------------- the network ------------------------- */

function build(width) {
    var model = tf.sequential();
    model.add(tf.layers.dense({
        inputShape: [Encode.SIZE], units: width, activation: 'relu'
    }));
    model.add(tf.layers.dense({units: Math.round(width / 2), activation: 'relu'}));
    // tanh, because the thing being predicted is a win or a loss and nothing
    // outside that range is meaningful
    model.add(tf.layers.dense({units: 1, activation: 'tanh'}));
    model.compile({optimizer: tf.train.adam(0.002), loss: 'meanSquaredError'});
    return model;
}

/* ---------------------------- reporting --------------------------- */

/**
 * Mean squared error alone is hard to read. Two things that are not: how often
 * the sign is right, and whether it is right for the reason you would hope -
 * a position one shot from the end should be easy, and one at the break should
 * be close to a coin toss. A model that is confident about the break has
 * learned something about the data rather than about the game.
 */
function report(model, data, rows, label) {
    var t = tensors(data, rows);
    var pred = model.predict(t.x).dataSync();
    var truth = t.y.dataSync();

    var buckets = [[1, 2], [3, 5], [6, 10], [11, 99]];
    var lines = [], seen = {}, right = 0, mse = 0;

    rows.forEach(function (r, i) {
        var ply = data.rows[r * STRIDE + PLY];
        var ok = (pred[i] >= 0) === (truth[i] >= 0);
        if (ok) right++;
        mse += (pred[i] - truth[i]) * (pred[i] - truth[i]);

        buckets.forEach(function (b, bi) {
            if (ply < b[0] || ply > b[1]) return;
            seen[bi] = seen[bi] || {n: 0, right: 0};
            seen[bi].n++;
            if (ok) seen[bi].right++;
        });
    });

    lines.push(label + ': ' + rows.length + ' turns, mse ' + (mse / rows.length).toFixed(4) +
        ', sign right ' + (100 * right / rows.length).toFixed(1) + '%');
    buckets.forEach(function (b, bi) {
        var s = seen[bi];
        if (!s) return;
        lines.push('    ' + (b[1] > 90 ? b[0] + '+' : b[0] + '-' + b[1]) +
            ' turns from the end: ' + (100 * s.right / s.n).toFixed(1) + '% of ' + s.n);
    });

    t.x.dispose(); t.y.dispose();
    return {text: lines.join('\n'), mse: mse / rows.length, accuracy: right / rows.length};
}

/* ----------------------------- saving ----------------------------- */

/**
 * Write the model where a browser can load it with tf.loadLayersModel.
 *
 * The pure javascript build of tfjs has no file system handlers - those live in
 * tfjs-node, which needs a native build - so the artifacts are caught and
 * written here instead. The layout is the one tfjs expects: a model.json
 * describing the topology and a weights file beside it.
 */
function save(model, dir) {
    fs.mkdirSync(dir, {recursive: true});
    return model.save(tf.io.withSaveHandler(function (artifacts) {
        fs.writeFileSync(path.join(dir, 'weights.bin'),
            Buffer.from(artifacts.weightData));
        fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({
            modelTopology: artifacts.modelTopology,
            format: artifacts.format,
            generatedBy: artifacts.generatedBy,
            convertedBy: null,
            weightsManifest: [{
                paths: ['weights.bin'],
                weights: artifacts.weightSpecs
            }]
        }));
        return {modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: 'JSON'
        }};
    }));
}

/** Read a model back off disk, the way the browser reads it over the network. */
function loadModel(dir) {
    var manifest = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
    var weights = fs.readFileSync(path.join(dir, 'weights.bin'));
    return tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: manifest.modelTopology,
        weightSpecs: manifest.weightsManifest[0].weights,
        weightData: new Uint8Array(weights).buffer
    }));
}

module.exports = {load: load, split: split, tensors: tensors, build: build,
    report: report, save: save, loadModel: loadModel,
    rackStarts: rackStarts, STRIDE: STRIDE};

/* ------------------------------------------------------------------ */

if (require.main !== module) return;

(async function main() {
    var dir = String(arg('data', 'data/v1'));
    var out = String(arg('out', 'model/value'));
    var epochs = +arg('epochs', 40);
    var width = +arg('width', 64);
    var patience = +arg('patience', 6);

    var data = load(dir);
    var parts = split(data, 0.12, 7);
    data.sources.forEach(function (m) {
        console.log('  ' + m.dir + ': ' + m.turns + ' turns from ' + m.racks +
            ' racks of ' + m.player);
    });
    console.log(data.count + ' turns from ' + parts.racks + ' racks (' +
        parts.train.length + ' to train on, ' + parts.valid.length + ' held back)');

    var tr = tensors(data, parts.train);
    var va = tensors(data, parts.valid);

    var model = build(width);
    console.log('network ' + Encode.SIZE + ' -> ' + width + ' -> ' +
        Math.round(width / 2) + ' -> 1, ' +
        model.countParams() + ' parameters');

    var best = Infinity, bestWeights = null, since = 0;
    await model.fit(tr.x, tr.y, {
        epochs: epochs, batchSize: 256, shuffle: true,
        validationData: [va.x, va.y],
        callbacks: {
            onEpochEnd: function (epoch, logs) {
                var mark = '';
                if (logs.val_loss < best - 1e-4) {
                    best = logs.val_loss;
                    bestWeights = model.getWeights().map(function (w) { return w.clone(); });
                    since = 0;
                    mark = '  <- best';
                } else {
                    since++;
                }
                console.log('  epoch ' + String(epoch + 1).padStart(3) +
                    '  train ' + logs.loss.toFixed(4) +
                    '  valid ' + logs.val_loss.toFixed(4) + mark);
                if (since >= patience) {
                    console.log('  no better in ' + patience + ' epochs, stopping');
                    model.stopTraining = true;
                }
            }
        }
    });

    if (bestWeights) model.setWeights(bestWeights);

    console.log('');
    console.log(report(model, data, parts.train, 'training').text);
    console.log(report(model, data, parts.valid, 'held back').text);

    // what a model that has learned nothing would score, for comparison
    var truth = va.y.dataSync();
    var mean = truth.reduce(function (a, b) { return a + b; }, 0) / truth.length;
    var flat = truth.reduce(function (s, t) { return s + (mean - t) * (mean - t); }, 0) / truth.length;
    console.log('  (always guessing ' + mean.toFixed(3) + ' would score mse ' +
        flat.toFixed(4) + ')');

    await save(model, out);
    console.log('\nsaved to ' + out + '/model.json');
})();
