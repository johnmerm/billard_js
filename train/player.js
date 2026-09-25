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
/*
 * Loaded twice over: by node with `require`, and by the page as a plain script
 * where the modules it needs are already globals. Hence the pattern below -
 * take what is on the page if it is there, ask node for it if it is not.
 */
var Rules = typeof Rules !== 'undefined' ? Rules : require('../rules.js');
var Geometry = typeof Geometry !== 'undefined' ? Geometry : require('./geometry.js');
var Match = typeof Match !== 'undefined' ? Match : require('./match.js');
var Bot = typeof Bot !== 'undefined' ? Bot : require('./bot.js');
var Encode = typeof Encode !== 'undefined' ? Encode : require('./encode.js');

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

    // The page fetches tensorflow only when somebody switches the AI on, so it
    // cannot be picked up when this file loads - only when it is first needed.
    var tf = typeof window !== 'undefined' && window.tf
        ? window.tf : require('@tensorflow/tfjs');

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
 *   explore how often to take a shot at random instead of the best one, 0 to 1.
 *           Zero is how it should play; something small is how it should
 *           generate its own training data, because a player that always takes
 *           what it already believes is best only ever shows itself positions
 *           it already understands.
 */
function create(opts) {
    opts = opts || {};
    var model = opts.model;
    var rand = Match.rng(opts.seed || 20250922);
    var shots = opts.shots === undefined ? 3 : opts.shots;
    var spread = opts.spread === undefined ? 2 : opts.spread;
    var explore = opts.explore || 0;
    var fallback = Bot.create({search: 0, seed: opts.seed, noise: opts.noise});

    /**
     * Set up a turn's thinking without doing any of it.
     *
     * The work is a couple of dozen simulated shots, which is most of a second
     * in one lump. On a page that is a second with nothing drawn, so the search
     * is handed back as something that can be stepped: `step` plays one shot,
     * `done` says when there are no more, and `result` names the winner. The
     * headless player simply steps it to the end in a loop, so there is one
     * implementation of the search and not two.
     */
    function plan(world, pos) {
        var legal = Rules.legalBalls(world, pos.groups, pos.player);
        var shortlist = Geometry.shortlist(world, legal,
            Rules.demands(world, pos.groups, pos.player));
        if (!shortlist.length) {
            return {
                step: function () { return false; },
                done: function () { return true; },
                total: 0, played: 0,
                result: function () { return fallback.shoot(world, pos); },
                chosen: function () { return null; }    // no pot to name
            };
        }

        var me = pos.player;
        var snap = Bot.snapshot(world);
        var queue = [];
        for (var i = 0; i < Math.min(shots, shortlist.length); i++) {
            var candidate = shortlist[i];
            variations(candidate, spread).forEach(function (params) {
                queue.push({params: params, candidate: candidate});
            });
        }

        var at = 0, tried = [], judged = [];
        var chosen = null;            // which pot it settled on, for the page to say

        function step() {
            if (at >= queue.length) return false;
            var entry = queue[at++];
            var params = entry.params;

            // back to where the turn started: the page goes on stepping the
            // table between one of these and the next, and a trial has to
            // begin from the position the player is actually facing
            Bot.restore(world, snap);

            var trial = {groups: pos.groups.slice(), player: pos.player,
                open: pos.open, broken: pos.broken};
            var out = Match.playShot(world, trial, params);

            if (out.gameOver) {
                tried.push({params: params, candidate: entry.candidate,
                    settled: out.gameOver.winner === me ? WIN : LOSS});
            } else {
                Match.apply(world, trial, out);
                tried.push({params: params, candidate: entry.candidate,
                    index: judged.length,
                    // a foul is worse than the position alone says: the
                    // opponent gets to put the ball wherever they like
                    penalty: out.foul ? 0.15 : 0});
                judged.push({features: Encode.encode(world, trial),
                    mine: trial.player === me});
            }

            Bot.restore(world, snap);
            return at < queue.length;
        }

        function result() {
            var values = judgeAll(model, judged);
            var best = null, bestScore = -Infinity;
            tried.forEach(function (t) {
                var score = t.settled !== undefined
                    ? t.settled
                    : values[t.index] - t.penalty;
                if (score > bestScore) {
                    bestScore = score;
                    best = t.params;
                    chosen = t.candidate;
                }
            });

            // Now and then play something else on purpose. Without it the next
            // round of training only ever sees the positions this model already
            // steers towards, and learns nothing it did not already believe.
            if (explore && tried.length > 1 && rand() < explore) {
                var pick = tried[Math.floor(rand() * tried.length)];
                if (pick && pick.settled === undefined) {
                    chosen = pick.candidate;
                    return pick.params;
                }
            }

            return best || fallback.shoot(world, pos);
        }

        return {
            step: step,
            done: function () { return at >= queue.length; },
            get played() { return at; },
            total: queue.length,
            result: result,
            /** The pot it settled on, once `result` has been asked for. */
            chosen: function () { return chosen; }
        };
    }

    function bestShot(world, pos) {
        var thinking = plan(world, pos);
        while (thinking.step()) { /* one simulated shot at a time */ }
        return thinking.result();
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
        plan: plan,
        place: place,
        shoot: function (world, pos) {
            if (!pos.broken) return fallback.shoot(world, pos);   // the break is the break
            return bestShot(world, pos);
        }
    };
}

/* The page needs this as a global; node needs it on module.exports. */
var Player = {create: create, variations: variations};
if (typeof module !== 'undefined' && module.exports) module.exports = Player;
