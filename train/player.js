/**
 * train/player.js - the player that thinks about what happens next.
 *
 * The baseline bot takes the straightest pot and never asks where the cue ball
 * finishes. This one asks, and the value network answers: for each shot worth
 * considering it plays the shot out in the simulator, looks at the table the
 * shot leaves, and scores it by how good that position is for whoever has to
 * play it. Then it takes the shot whose aftermath it likes best.
 *
 * That is the whole of the improvement. The network never picks a shot and
 * never aims; it only judges positions, which is the thing a simulator cannot
 * do for itself. Everything else - which pots exist, whether this one drops,
 * where the balls end up - comes from the physics, exactly, for free.
 *
 * It is a one move search. Two would be better and costs the square.
 */
var tf = require('@tensorflow/tfjs');
var Rules = require('../rules.js');
var Geometry = require('./geometry.js');
var Match = require('./match.js');
var Bot = require('./bot.js');
var Encode = require('./encode.js');

var WIN = 1e6, LOSS = -1e6;

/**
 * The shots worth trying for one pot: the straightforward one, and the same
 * pot played softer or harder and with follow or draw, which is what moves the
 * cue ball somewhere useful afterwards.
 */
function variations(candidate, spread) {
    var base = Bot.power(candidate);
    var out = [];
    var powers = spread > 1 ? [base * 0.8, base, base * 1.35] : [base];
    var verts = spread > 2 ? [-0.5, 0, 0.5] : [0];

    powers.forEach(function (p) {
        verts.forEach(function (v) {
            out.push({angle: candidate.angle, power: p, side: 0, vert: v, elevation: 0});
        });
    });
    return out;
}

/**
 * Ask the network about a batch of positions at once.
 *
 * One call per position would spend most of its time in tensorflow's own
 * overhead rather than on the arithmetic - the network is tiny and the batch is
 * a couple of dozen rows - so every shot in a turn is played first and they are
 * all judged together.
 *
 * The network always answers from the point of view of whoever is about to
 * play, so a position left to the opponent has to be turned round before it can
 * be compared with one left to us.
 */
function judgeAll(model, rows) {
    if (!rows.length) return [];

    var flat = new Float32Array(rows.length * Encode.SIZE);
    rows.forEach(function (row, i) { flat.set(row.features, i * Encode.SIZE); });

    var values = tf.tidy(function () {
        return model.predict(tf.tensor2d(flat, [rows.length, Encode.SIZE])).dataSync();
    });

    return rows.map(function (row, i) {
        return row.mine ? values[i] : -values[i];
    });
}

/**
 * @param {Object} opts {model, shots, spread, seed, noise}
 *   shots   how many of the shortlisted pots to try (default 3)
 *   spread  1 just the plain shot, 2 also softer and harder, 3 also with
 *           follow and draw - 1, 3 and 9 simulated shots per pot
 */
function create(opts) {
    opts = opts || {};
    var model = opts.model;
    var rand = Match.rng(opts.seed || 20250922);
    var shots = opts.shots === undefined ? 3 : opts.shots;
    var spread = opts.spread === undefined ? 2 : opts.spread;
    var fallback = Bot.create({search: 0, seed: opts.seed, noise: opts.noise});

    function bestShot(world, pos) {
        var legal = Rules.legalBalls(world, pos.groups, pos.player);
        var shortlist = Geometry.candidates(world, legal);
        if (!shortlist.length) return fallback.shoot(world, pos);

        var me = pos.player;
        var snap = Bot.snapshot(world);
        var tried = [], judged = [];

        for (var i = 0; i < Math.min(shots, shortlist.length); i++) {
            var tries = variations(shortlist[i], spread);

            for (var v = 0; v < tries.length; v++) {
                var params = tries[v];
                var trial = {groups: pos.groups.slice(), player: pos.player,
                    open: pos.open, broken: pos.broken};
                var out = Match.playShot(world, trial, params);

                if (out.gameOver) {
                    tried.push({params: params,
                        settled: out.gameOver.winner === me ? WIN : LOSS});
                } else {
                    Match.apply(world, trial, out);
                    tried.push({params: params, index: judged.length,
                        // a foul is worse than the position alone says: the
                        // opponent gets to put the ball wherever they like
                        penalty: out.foul ? 0.15 : 0});
                    judged.push({features: Encode.encode(world, trial),
                        mine: trial.player === me});
                }

                Bot.restore(world, snap);
            }
        }

        var values = judgeAll(model, judged);
        var best = null, bestScore = -Infinity;
        tried.forEach(function (t) {
            var score = t.settled !== undefined
                ? t.settled
                : values[t.index] - t.penalty;
            if (score > bestScore) { bestScore = score; best = t.params; }
        });

        return best || fallback.shoot(world, pos);
    }

    /** Ball in hand: the same question, asked of where to put it down. */
    function place(world, pos) {
        var W = Match.TABLE_W, H = Match.TABLE_H;
        var maxX = pos.kitchenOnly ? W * 0.25 : W;
        var snap = Bot.snapshot(world);
        var spots = [], judged = [];

        for (var i = 1; i <= 8; i++) {
            for (var j = 1; j <= 5; j++) {
                var x = maxX * i / 9, y = H * j / 6;
                if (!Rules.placementLegal(world, x, y, pos.kitchenOnly)) continue;

                world.ball(0).placeAt(x, y);
                spots.push({x: x, y: y});
                judged.push({
                    features: Encode.encode(world, {groups: pos.groups,
                        player: pos.player, open: pos.open}),
                    mine: true
                });
            }
        }
        Bot.restore(world, snap);
        if (!spots.length) return fallback.place(world, pos);

        var values = judgeAll(model, judged);
        var best = null, bestScore = -Infinity;
        spots.forEach(function (spot, i) {
            var score = values[i] + rand() * 1e-6;      // break ties without a bias
            if (score > bestScore) { bestScore = score; best = spot; }
        });
        return best;
    }

    return {
        name: opts.name || 'value',
        place: place,
        shoot: function (world, pos) {
            if (!pos.broken) return fallback.shoot(world, pos);   // the break is the break
            return bestShot(world, pos);
        }
    };
}

module.exports = {create: create, variations: variations};
