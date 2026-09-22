#!/usr/bin/env node
/**
 * train/collect.js - self play, written down.
 *
 *   node train/collect.js --games 400 --workers 4 --out data/v1
 *
 * Plays racks and records, for every turn, the position the player to move
 * inherited and whether that player went on to win. That pair is the whole
 * training set for a value function: given a table and whose turn it is, how
 * often does this end well?
 *
 * The position is taken *before* the player does anything, ball in hand
 * included, because that is exactly what the shot before it created - and
 * judging what a shot leaves the opponent is the question a searching player
 * needs answered.
 *
 * Games are split across processes because the simulator is the bottleneck and
 * it is pure arithmetic in one thread. Each worker writes its own shard; there
 * is no shared state and nothing to synchronise.
 */
var fs = require('fs');
var path = require('path');
var os = require('os');
var child = require('child_process');

var Match = require('./match.js');
var Bot = require('./bot.js');
var Encode = require('./encode.js');

var STRIDE = Encode.SIZE + 2;          // features, then the label and the ply

function arg(name, fallback) {
    var i = process.argv.indexOf('--' + name);
    if (i < 0) return fallback;
    var next = process.argv[i + 1];
    return (next === undefined || next.slice(0, 2) === '--') ? true : next;
}

/**
 * Play `games` racks and return every turn in them, labelled.
 *
 * @return {Object} {rows: Float32Array, turns, finished, wins}
 */
function collect(games, seed0, opts) {
    opts = opts || {};
    var rows = [];
    var finished = 0, drawn = 0;

    for (var g = 0; g < games; g++) {
        var seed = seed0 + g;
        var players = [
            Bot.create({search: opts.search, seed: seed * 7919, noise: opts.noise}),
            Bot.create({search: opts.search, seed: seed * 104729, noise: opts.noise})
        ];

        var turns = [];
        var result = Match.playGame(players, {
            seed: seed,
            observe: function (world, pos) {
                turns.push({
                    features: Encode.encode(world, pos),
                    player: pos.player
                });
            }
        });

        if (result.winner === null) { drawn++; continue; }   // unfinished, no label
        finished++;

        turns.forEach(function (turn, i) {
            rows.push({
                features: turn.features,
                label: turn.player === result.winner ? 1 : -1,
                // how far from the end this was, which is worth having when
                // deciding later whether to trust early positions as much
                ply: turns.length - i
            });
        });
    }

    var out = new Float32Array(rows.length * STRIDE);
    rows.forEach(function (row, i) {
        out.set(row.features, i * STRIDE);
        out[i * STRIDE + Encode.SIZE] = row.label;
        out[i * STRIDE + Encode.SIZE + 1] = row.ply;
    });

    return {rows: out, turns: rows.length, finished: finished, drawn: drawn};
}


module.exports = {collect: collect, STRIDE: STRIDE};

/* ------------------------------------------------------------------ *
 * Everything below only runs when this file is the program. Requiring it
 * for `collect` must not start forking workers, which is exactly what it
 * did the first time a test asked for it.
 * ------------------------------------------------------------------ */

if (require.main !== module) return;

if (process.env.BILLIARDS_SHARD) {
    var job = JSON.parse(process.env.BILLIARDS_SHARD);
    var got = collect(job.games, job.seed, job);
    fs.writeFileSync(job.file, Buffer.from(got.rows.buffer, 0, got.rows.byteLength));
    process.send({turns: got.turns, finished: got.finished, drawn: got.drawn});
    process.exit(0);
}

/* --------------------------- the driver --------------------------- */

var games = +arg('games', 200);
var workers = Math.max(1, Math.min(+arg('workers', os.cpus().length), games));
var outDir = String(arg('out', 'data/v' + Encode.VERSION));
var seed0 = +arg('seed', 1);
var search = +arg('search', 4);
var noise = +arg('noise', 0.01);

fs.mkdirSync(outDir, {recursive: true});

var per = Math.ceil(games / workers);
var started = Date.now();
var done = 0, totals = {turns: 0, finished: 0, drawn: 0};
var shards = [];

console.log('collecting ' + games + ' racks across ' + workers + ' workers' +
    ' (search=' + search + ', noise=' + noise + ')');

for (var i = 0; i < workers; i++) {
    var mine = Math.min(per, games - i * per);
    if (mine <= 0) { workers = i; break; }

    var file = path.join(outDir, 'shard-' + i + '.f32');
    shards.push(file);

    var proc = child.fork(__filename, [], {
        env: Object.assign({}, process.env, {
            BILLIARDS_SHARD: JSON.stringify({
                games: mine, seed: seed0 + i * per * 1000,
                file: file, search: search, noise: noise
            })
        })
    });

    proc.on('message', function (msg) {
        totals.turns += msg.turns;
        totals.finished += msg.finished;
        totals.drawn += msg.drawn;
        done++;
        console.log('  worker ' + done + '/' + workers + ': ' + msg.turns +
            ' turns from ' + msg.finished + ' racks' +
            (msg.drawn ? ' (' + msg.drawn + ' unfinished)' : ''));
        if (done === workers) finish();
    });
}

function finish() {
    var wall = (Date.now() - started) / 1000;
    var meta = {
        encoder: Encode.VERSION,
        size: Encode.SIZE,
        stride: STRIDE,
        labels: Encode.labels(),
        turns: totals.turns,
        racks: totals.finished,
        unfinished: totals.drawn,
        shards: shards.map(function (f) { return path.basename(f); }),
        search: search, noise: noise, seed: seed0,
        seconds: wall
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

    console.log('');
    console.log(totals.turns + ' turns from ' + totals.finished + ' racks in ' +
        wall.toFixed(1) + ' s (' + (totals.finished / wall).toFixed(1) + ' racks/s, ' +
        (totals.turns / wall).toFixed(0) + ' turns/s)');
    console.log('written to ' + outDir + '/ (' +
        (totals.turns * STRIDE * 4 / 1e6).toFixed(1) + ' MB)');
}

