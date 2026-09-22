/**
 * Value network tests: node test/value.test.js
 *
 * Training is slow and its output is a number that is hard to argue with, so
 * these check the plumbing rather than the learning: that a rack never lands on
 * both sides of the train/validation fence, that the network can learn a rule
 * that is definitely there, and - the one that actually matters for the game -
 * that a model saved here loads in a browser and gives the same answers.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var tf = require('@tensorflow/tfjs');
var Encode = require('../train/encode.js');
var Value = require('../train/value.js');

var failures = 0;

function check(name, ok, detail) {
    if (ok) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? ' -> ' + detail : ''));
    }
}

var STRIDE = Value.STRIDE;

/**
 * A dataset with a rule in it: the label follows one feature, so a network that
 * cannot find it is broken rather than merely untrained. Laid out as real racks
 * of several turns each, since that is what the splitter has to cope with.
 */
function synthetic(racks, turnsPer, seed) {
    var rows = [];
    var x = seed || 1;
    function rand() {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
    }

    for (var r = 0; r < racks; r++) {
        var n = 2 + Math.floor(rand() * turnsPer);
        var winner = rand() < 0.5 ? 1 : -1;
        for (var t = 0; t < n; t++) {
            var features = new Float32Array(Encode.SIZE);
            for (var k = 0; k < Encode.SIZE; k++) features[k] = rand();
            // the rule: feature 0 says who wins, most of the time
            features[0] = winner > 0 ? 0.8 + rand() * 0.2 : rand() * 0.2;
            rows.push({features: features, label: winner, ply: n - t});
        }
    }

    var out = new Float32Array(rows.length * STRIDE);
    rows.forEach(function (row, i) {
        out.set(row.features, i * STRIDE);
        out[i * STRIDE + Encode.SIZE] = row.label;
        out[i * STRIDE + Encode.SIZE + 1] = row.ply;
    });
    return {rows: out, count: rows.length, meta: {encoder: Encode.VERSION}};
}

/* ------------------------------------------------------------------ */

(async function () {
    console.log('finding the racks');

    var data = synthetic(40, 8, 99);
    var starts = Value.rackStarts(data);
    check('it finds every rack', starts.length === 40, String(starts.length));
    check('the first row starts one', starts[0] === 0);
    check('each rack ends one turn from the end', starts.slice(1).every(function (s) {
        return data.rows[(s - 1) * STRIDE + Encode.SIZE + 1] === 1;
    }));

    console.log('splitting');

    var parts = Value.split(data, 0.25, 3);
    check('every turn lands on one side or the other',
        parts.train.length + parts.valid.length === data.count,
        parts.train.length + ' + ' + parts.valid.length + ' vs ' + data.count);
    check('and only one', parts.train.filter(function (i) {
        return parts.valid.indexOf(i) >= 0;
    }).length === 0);
    check('roughly the fraction asked for',
        Math.abs(parts.valid.length / data.count - 0.25) < 0.1,
        (parts.valid.length / data.count).toFixed(2));

    // the point of splitting by rack: turns from one rack are near copies of
    // each other, so any rack straddling the fence leaks the answer across it
    var ends = starts.slice(1).concat([data.count]);
    var straddled = starts.filter(function (s, i) {
        var inTrain = false, inValid = false;
        for (var k = s; k < ends[i]; k++) {
            if (parts.train.indexOf(k) >= 0) inTrain = true;
            if (parts.valid.indexOf(k) >= 0) inValid = true;
        }
        return inTrain && inValid;
    });
    check('no rack is on both sides of the fence', straddled.length === 0,
        straddled.length + ' straddle');

    console.log('learning something that is there');

    var big = synthetic(300, 8, 7);
    var bigParts = Value.split(big, 0.2, 11);
    var tr = Value.tensors(big, bigParts.train);
    var va = Value.tensors(big, bigParts.valid);

    var model = Value.build(32);
    check('the network is the shape it says',
        model.inputs[0].shape[1] === Encode.SIZE &&
        model.outputs[0].shape[1] === 1);

    await model.fit(tr.x, tr.y, {epochs: 30, batchSize: 64, verbose: 0, shuffle: true});
    var scored = Value.report(model, big, bigParts.valid, 'held back');
    check('it finds the rule', scored.accuracy > 0.9,
        (scored.accuracy * 100).toFixed(1) + '% right, mse ' + scored.mse.toFixed(3));

    console.log('it predicts within the range it was given');

    var probe = model.predict(tf.randomUniform([64, Encode.SIZE])).dataSync();
    check('nothing outside a win and a loss',
        Array.prototype.every.call(probe, function (p) { return p >= -1 && p <= 1; }));

    console.log('saving for the browser');

    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'value-'));
    await Value.save(model, dir);

    check('there is a model.json', fs.existsSync(path.join(dir, 'model.json')));
    check('and a weights file beside it', fs.existsSync(path.join(dir, 'weights.bin')));

    var manifest = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
    check('the manifest points at the weights',
        manifest.weightsManifest[0].paths[0] === 'weights.bin');
    check('and describes every one of them',
        manifest.weightsManifest[0].weights.length === model.getWeights().length,
        manifest.weightsManifest[0].weights.length + ' vs ' + model.getWeights().length);

    // The real check. A browser fetches model.json, reads the manifest, fetches
    // the weights and rebuilds the network; the same three pieces are handed to
    // tfjs here, and the answers have to come back identical.
    var loaded = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: manifest.modelTopology,
        weightSpecs: manifest.weightsManifest[0].weights,
        weightData: new Uint8Array(fs.readFileSync(path.join(dir, 'weights.bin'))).buffer
    }));

    var sample = tf.randomUniform([16, Encode.SIZE]);
    var before = model.predict(sample).dataSync();
    var after = loaded.predict(sample).dataSync();
    var worst = 0;
    for (var i = 0; i < before.length; i++) {
        worst = Math.max(worst, Math.abs(before[i] - after[i]));
    }
    check('a reloaded model gives the same answers', worst < 1e-6, 'worst ' + worst);

    fs.rmSync(dir, {recursive: true, force: true});

    console.log('');
    if (failures) {
        console.log(failures + ' check(s) failed');
        process.exit(1);
    }
    console.log('all checks passed');
})();
