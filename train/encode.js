/**
 * train/encode.js - a table as a fixed list of numbers.
 *
 * Everything is written from the point of view of whoever is about to shoot, and
 * by role rather than by number: "one of mine" and "one of theirs", never "the
 * 3 ball". Ball numbers carry no information in eight ball - the 3 and the 5
 * play identically - so feeding them in would ask the network to learn the same
 * lesson fifteen times over and hand it a way to overfit to the rack.
 *
 * Three kinds of feature:
 *
 *   the grid      where the balls are, coarsely, as occupancy over a grid, one
 *                 channel for mine, one for theirs, one for the 8. Coarse on
 *                 purpose: exact coordinates are what the simulator is for.
 *   the cue ball  where it is, and whether it is in hand, which is worth a lot
 *   the shortlist what geometry already knows - how many pots are on, how
 *                 straight the best one is, how far it has to travel. This is
 *                 the expensive part of a position to see and it is free here,
 *                 so there is no reason to make a network rediscover it.
 *
 * The same function runs at training time and at play time. If they ever
 * disagree the network is being asked questions in a language it was never
 * taught, so nothing here may depend on anything but the table and the position.
 */
var Rules = require('../rules.js');
var Geometry = require('./geometry.js');

var VERSION = 1;

var GRID_X = 8, GRID_Y = 4;
var GRID = GRID_X * GRID_Y;
var CHANNELS = 3;                      // mine, theirs, the 8
var SHORTLIST = 8;                     // how many pots are worth describing

var SIZE = CHANNELS * GRID + 3 + 5 + 5;

/** Which cell a table coordinate falls in. */
function cell(world, x, y) {
    var i = Math.floor(x / world.width * GRID_X);
    var j = Math.floor(y / world.height * GRID_Y);
    return Math.max(0, Math.min(GRID_X - 1, i)) * GRID_Y +
        Math.max(0, Math.min(GRID_Y - 1, j));
}

/**
 * @param {Object} world  the table
 * @param {Object} pos    {groups, player, open}
 * @param {Float32Array} [into]  somewhere to write, for a hot loop
 * @return {Float32Array} SIZE numbers in 0..1
 */
function encode(world, pos, into) {
    var out = into || new Float32Array(SIZE);
    out.fill(0);

    var player = pos.player;
    var mine = pos.groups[player];
    var theirs = pos.groups[1 - player];
    var cue = world.ball(0);
    var at = 0;

    // --- where everything is
    var mineLeft = 0, theirsLeft = 0;
    world.balls.forEach(function (b) {
        if (!b.active || b.id === 0) return;
        var c = cell(world, b.x, b.y);
        var channel;
        if (b.id === 8) {
            channel = 2;
        } else if (!mine) {
            // an open table: nothing is anybody's yet, so both halves read the
            // same way round for both players
            channel = Rules.groupOf(b.id) === 'solids' ? 0 : 1;
            if (Rules.groupOf(b.id) === 'solids') mineLeft++; else theirsLeft++;
        } else {
            channel = Rules.groupOf(b.id) === mine ? 0 : 1;
            if (channel === 0) mineLeft++; else theirsLeft++;
        }
        // Crowding matters - two balls in a cell is a cluster and three is
        // trouble - but it has to saturate, or a fresh rack puts a 7 in one
        // cell and swamps everything else the network is looking at.
        var i = channel * GRID + c;
        out[i] = Math.min(1, out[i] + 0.34);
    });
    at = CHANNELS * GRID;

    // --- the cue ball
    out[at++] = cue.active ? cue.x / world.width : 0.5;
    out[at++] = cue.active ? cue.y / world.height : 0.5;
    out[at++] = cue.active ? 0 : 1;          // in hand is worth knowing about

    // --- the shape of the game
    var target = Rules.legalTarget(world, pos.groups, player);
    out[at++] = mineLeft / 7;
    out[at++] = theirsLeft / 7;
    out[at++] = pos.open ? 1 : 0;
    out[at++] = target === 'eight' ? 1 : 0;
    out[at++] = (mineLeft - theirsLeft) / 7 * 0.5 + 0.5;   // who is ahead

    // --- what is actually on
    var legal = Rules.legalBalls(world, pos.groups, player);
    var shots = cue.active ? Geometry.candidates(world, legal) : [];
    var reach = world.width + world.height;

    out[at++] = Math.min(1, shots.length / SHORTLIST);
    if (shots.length) {
        var best = shots[0];
        out[at++] = Math.cos(best.cut);                       // 1 is dead straight
        out[at++] = Math.min(1, best.distance / reach);
        out[at++] = Math.min(1, best.toPocket / reach);
        // a second shot on means the first one can be played for position
        out[at++] = shots.length > 1 ? Math.cos(shots[1].cut) : 0;
    } else {
        at += 4;                                              // nothing on: zeros
    }

    return out;
}

/** Names in the same order as the values, for looking at what a net learned. */
function labels() {
    var names = [];
    ['mine', 'theirs', 'eight'].forEach(function (ch) {
        for (var i = 0; i < GRID_X; i++) {
            for (var j = 0; j < GRID_Y; j++) names.push(ch + '[' + i + ',' + j + ']');
        }
    });
    return names.concat(['cue.x', 'cue.y', 'cue.inHand',
        'mineLeft', 'theirsLeft', 'open', 'onEight', 'ahead',
        'shots', 'bestCut', 'bestDistance', 'bestToPocket', 'secondCut']);
}

module.exports = {
    VERSION: VERSION, SIZE: SIZE, GRID_X: GRID_X, GRID_Y: GRID_Y,
    encode: encode, labels: labels
};
